import type { TextTaskItemRecord } from "../../../shared/text/text-types";
import crypto from "node:crypto";

import { is_task_skipped_item_status } from "../../../domain/batch-translation";
import { read_json_integer, read_json_record, type MutableJsonRecord } from "../../../domain/json";
import { project_text_resource_references } from "../../../shared/text/text-resource-reference";
import type { PlanningWorkerPool } from "./planning-worker-pool";
import { build_token_count_cache_key, TokenCountCache } from "./token-count-cache";
import type {
  TranslationContext,
  TranslationRetryPlan,
  TranslationPlan,
  TranslationTokenMetric,
} from "./translation-plan-types";
import { AppError } from "../../../shared/error";
import { read_task_item_id, read_task_item_status } from "../translation-item";

const DEFAULT_INPUT_TOKEN_LIMIT = 512; // 模型未配置 token 限制时使用保守默认值，避免一次塞入过长 prompt。
const HASH_YIELD_EVERY_ITEMS = 1024; // 主线程计算 hash 时分批让出事件循环，避免大项目启动阶段长时间无响应。
const SAKURA_MAX_ITEMS_PER_WORK_UNIT = 1; // 纯文本响应没有 item 边界，Sakura 每次只请求一个 item。

const END_LINE_PUNCTUATION = new Set([".", "。", "?", "？", "!", "！", "…", "'", '"', "」", "』"]); // chunk 拆分优先在句末标点处分割，减少上下文被硬切断的概率。

/**
 * TranslationPlanner 是后台任务唯一规划器：它复用进程内 token 缓存，并把精确计数交给 planning worker。
 */
export class TranslationPlanner {
  private readonly planning_worker_pool: Pick<PlanningWorkerPool, "count_items">; // 只做纯计算，不接触数据库和事件。
  private readonly token_cache = new TokenCountCache(); // 进程内计算指标缓存，随 BackendServices 生命周期释放。

  /**
   * 注入 planning worker，规划缓存由 planner 自己持有。
   */
  public constructor(options: { planningWorkerPool: Pick<PlanningWorkerPool, "count_items"> }) {
    this.planning_worker_pool = options.planningWorkerPool;
  }

  /**
   * 构建翻译初始上下文，切块使用精确 token 指标并按模型协议准备 preceding。
   */
  public async build_translation_plan(
    items: TextTaskItemRecord[],
    config: MutableJsonRecord,
    model: MutableJsonRecord,
    signal: AbortSignal,
    target_ids?: ReadonlySet<number>,
  ): Promise<TranslationPlan> {
    const threshold = this.get_input_token_limit(model, DEFAULT_INPUT_TOKEN_LIMIT);
    const is_sakura = String(model["api_format"] ?? "") === "SakuraLLM"; // 纯文本响应要求单 item 且不携带 preceding。
    const metrics = await this.resolve_item_metrics(
      target_ids === undefined
        ? items
        : items.filter((item) => target_ids.has(read_task_item_id(item))),
      signal,
    );
    const chunks = this.generate_item_chunks(
      items,
      metrics,
      threshold,
      is_sakura ? 0 : read_json_integer(config["preceding_lines_threshold"], 0),
      signal,
      is_sakura ? SAKURA_MAX_ITEMS_PER_WORK_UNIT : Number.POSITIVE_INFINITY,
    );
    return {
      metrics,
      contexts: chunks.map(({ chunk_items, precedings }) => ({
        work_unit_id: crypto.randomUUID(),
        items: chunk_items,
        precedings,
        token_threshold: threshold,
        split_count: 0,
        retry_count: 0,
        is_initial: true,
      })),
    };
  }

  /**
   * 重试复用本轮源文指标；单条按调用方给定上限重试，超限写回由 Runner 决定。
   */
  public build_translation_retry_plan(
    context: TranslationContext,
    returned_items: TextTaskItemRecord[],
    metrics: ReadonlyMap<number, TranslationTokenMetric>,
    retry_limit: number,
    mark_error: (item: TextTaskItemRecord) => void,
    signal: AbortSignal,
  ): TranslationRetryPlan {
    this.throw_if_aborted(signal);
    const pending_by_id = new Map(
      returned_items
        .filter((item) => read_task_item_status(item) === "NONE")
        .map((item) => [read_task_item_id(item), item]),
    );
    // worker 仅决定待重试集合；拆块始终使用本轮原始源文与文件顺序。
    const pending_items = context.items.filter((item) =>
      pending_by_id.has(read_task_item_id(item)),
    );
    if (pending_items.length === 0) {
      return { retry_contexts: [], forced_error_items: [] };
    }
    if (pending_items.length === 1) {
      const item = pending_items[0] as MutableJsonRecord;
      if (context.retry_count < retry_limit) {
        return {
          retry_contexts: [
            {
              ...context,
              work_unit_id: crypto.randomUUID(),
              items: [item],
              precedings: [],
              retry_count: context.retry_count + 1,
              is_initial: false,
            },
          ],
          forced_error_items: [],
        };
      }
      // 终态提交消费 worker 的写回快照；本轮源文快照仅用于再次规划。
      const failed_item = pending_by_id.get(read_task_item_id(item))!;
      mark_error(failed_item);
      return { retry_contexts: [], forced_error_items: [failed_item] };
    }
    const next_threshold = Math.max(
      1,
      Math.floor(context.token_threshold * this.get_split_factor(context.token_threshold)),
    );
    const sub_chunks = this.generate_item_chunks(pending_items, metrics, next_threshold, 0, signal);
    return {
      retry_contexts: sub_chunks.map(({ chunk_items }) => ({
        work_unit_id: crypto.randomUUID(),
        items: chunk_items,
        precedings: [],
        token_threshold: next_threshold,
        split_count: context.split_count + 1,
        retry_count: 0,
        is_initial: false,
      })),
      forced_error_items: [],
    };
  }

  /**
   * 共享切块实现，只依赖 item 快照和已解析 token 指标，不在主线程执行 tokenizer。
   */
  private generate_item_chunks(
    items: TextTaskItemRecord[],
    metric_by_id: ReadonlyMap<number, TranslationTokenMetric>,
    input_token_threshold: number,
    preceding_lines_threshold: number,
    signal: AbortSignal,
    max_items_per_chunk = Number.POSITIVE_INFINITY, // 普通模型不设上限，纯文本协议按 item 边界收敛。
  ): Array<{ chunk_items: TextTaskItemRecord[]; precedings: TextTaskItemRecord[] }> {
    const line_limit = Math.max(8, Math.trunc(input_token_threshold / 16));
    const chunks: Array<{ chunk_items: TextTaskItemRecord[]; precedings: TextTaskItemRecord[] }> =
      [];
    let chunk_start = 0; // 当前单元首条目标在完整工程序列中的位置。
    let line_length = 0;
    let token_length = 0;
    let chunk: TextTaskItemRecord[] = [];
    for (const [index, item] of items.entries()) {
      this.throw_if_aborted(signal);
      const metric = metric_by_id.get(read_task_item_id(item));
      if (metric === undefined) {
        continue;
      }
      if (
        chunk.length > 0 &&
        (chunk.length >= max_items_per_chunk ||
          line_length + metric.line_count > line_limit ||
          token_length + metric.token_count > input_token_threshold ||
          String(item["file_path"] ?? "") !== String(chunk[chunk.length - 1]?.["file_path"] ?? ""))
      ) {
        chunks.push({
          chunk_items: chunk,
          precedings: this.generate_preceding_chunk(
            items,
            chunk,
            chunk_start,
            preceding_lines_threshold,
          ),
        });
        line_length = 0;
        token_length = 0;
        chunk = [];
      }
      if (chunk.length === 0) chunk_start = index;
      chunk.push(item);
      line_length += metric.line_count;
      token_length += metric.token_count;
    }
    if (chunk.length > 0) {
      chunks.push({
        chunk_items: chunk,
        precedings: this.generate_preceding_chunk(
          items,
          chunk,
          chunk_start,
          preceding_lines_threshold,
        ),
      });
    }
    return chunks;
  }

  /**
   * 为当前 item 快照解析 token/行数指标，cache 命中直接复用，缺失才调用 worker。
   */
  private async resolve_item_metrics(
    items: TextTaskItemRecord[],
    signal: AbortSignal,
  ): Promise<Map<number, TranslationTokenMetric>> {
    const metrics = new Map<number, TranslationTokenMetric>();
    const missing = new Map<
      string,
      {
        text: string;
        targets: Array<{ item_id: number; line_count: number }>;
      }
    >(); // 仅缺失文本保存回填位置，同文条目共用一次计数。
    const seen_item_ids = new Set<number>();
    for (const [index, item] of items.entries()) {
      this.throw_if_aborted(signal);
      if (read_task_item_status(item) !== "NONE") continue;
      const item_id = read_task_item_id(item);
      if (item_id <= 0 || seen_item_ids.has(item_id)) continue;
      seen_item_ids.add(item_id);
      const raw_src = String(item["src"] ?? "");
      // token 指标使用短投影，行数仍以原文为准。
      const text = project_text_resource_references(raw_src).text;
      const line_count = raw_src.split(/\r?\n/).filter((line) => line.trim() !== "").length;
      const key = build_token_count_cache_key(text);
      const token_count = this.token_cache.get(key);
      if (token_count !== undefined) {
        metrics.set(item_id, { token_count, line_count });
      } else {
        let pending = missing.get(key);
        if (pending === undefined) {
          pending = { text, targets: [] };
          missing.set(key, pending);
        }
        pending.targets.push({ item_id, line_count });
      }
      if (index > 0 && index % HASH_YIELD_EVERY_ITEMS === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
    if (missing.size === 0) return metrics;
    const results = await this.planning_worker_pool.count_items(
      [...missing.values()].map((pending) => pending.text),
      signal,
    );
    this.throw_if_aborted(signal);
    let index = 0;
    for (const [key, pending] of missing) {
      const token_count = results[index++];
      if (token_count === undefined) throw new AppError("runtime.internal_invariant");
      this.token_cache.set(key, token_count);
      for (const { item_id, line_count } of pending.targets) {
        metrics.set(item_id, { token_count, line_count });
      }
    }
    return metrics;
  }

  /**
   * 生成翻译上文块，边界跟随文件路径和句末标点。
   */
  private generate_preceding_chunk(
    items: TextTaskItemRecord[],
    chunk: TextTaskItemRecord[],
    start: number,
    preceding_lines_threshold: number,
  ): MutableJsonRecord[] {
    const result: MutableJsonRecord[] = [];
    const current_file_path = String(chunk[chunk.length - 1]?.["file_path"] ?? "");
    for (let index = start - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (item === undefined || is_task_skipped_item_status(read_task_item_status(item))) {
        continue;
      }
      const src = String(item["src"] ?? "").trim();
      if (src === "" || result.length >= preceding_lines_threshold) {
        break;
      }
      if (String(item["file_path"] ?? "") !== current_file_path) {
        break;
      }
      const last_char = src.at(-1) ?? "";
      if (END_LINE_PUNCTUATION.has(last_char)) {
        result.push(item);
      } else {
        break;
      }
    }
    return result.reverse();
  }

  /**
   * 失败拆分比例使用 `pow(16 / t0, 0.25)` 的收敛速度。
   */
  private get_split_factor(token_threshold: number): number {
    return Math.pow(16 / Math.max(17, token_threshold), 0.25);
  }

  /**
   * 输入 token 阈值读取集中处理，保护模型配置缺字段场景。
   */
  private get_input_token_limit(model: MutableJsonRecord, fallback: number): number {
    const threshold = read_json_record(model["threshold"]);
    return Math.max(16, read_json_integer(threshold["input_token_limit"], fallback));
  }

  /**
   * 规划阶段主动响应停止信号，避免已取消任务继续规划。
   */
  private throw_if_aborted(signal: AbortSignal): void {
    if (signal.aborted) {
      throw signal.reason instanceof Error
        ? signal.reason
        : new Error("Task planning was cancelled.");
    }
  }
}
