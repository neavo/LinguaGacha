import crypto from "node:crypto";

import { is_task_skipped_item_status } from "../../../domain/task";
import { read_json_integer, read_json_record, type MutableJsonRecord } from "../../../domain/json";
import { read_item_name_text } from "../../../shared/item-name";
import {
  project_text_resource_references,
  remove_text_resource_references,
} from "../../../shared/text/text-resource-reference";
import type { PlanningWorkerPool } from "./planning-worker-pool";
import {
  build_task_token_metric_cache_key,
  count_non_empty_source_lines,
  TaskTokenMetricCache,
  type TaskTokenCountInput,
  type TaskTokenMetric,
} from "./token-metric-cache";
import type {
  AnalysisContext,
  AnalysisItemContext,
  TranslationContext,
  TranslationRetryPlan,
} from "./task-plan-types";
import {
  build_analysis_checkpoint_status_map,
  is_analyzable_task_item,
  read_task_item_id,
  read_task_item_status,
} from "../task-item";

const DEFAULT_INPUT_TOKEN_LIMIT = 512; // 模型未配置 token 限制时使用保守默认值，避免一次塞入过长 prompt。
const DEFAULT_ANALYSIS_INPUT_TOKEN_LIMIT = 512; // 分析 prompt 额外包含术语抽取说明，默认 token 门槛独立保留。
const HASH_YIELD_EVERY_ITEMS = 1024; // 主线程计算 hash 时分批让出事件循环，避免大项目启动阶段长时间无响应。
const SAKURA_MAX_ITEMS_PER_WORK_UNIT = 1; // 纯文本响应没有 item 边界，Sakura 每次只请求一个 item。

const END_LINE_PUNCTUATION = new Set([".", "。", "?", "？", "!", "！", "…", "'", '"', "」", "』"]); // chunk 拆分优先在句末标点处分割，减少上下文被硬切断的概率。

/**
 * 主线程为 planning worker 准备的最小计数输入及其缓存身份。
 */
interface MetricSeed {
  item_id: number; // 计数结果回填到原 item 的稳定键
  cache_key: string; // 模型 tokenizer 与源文共同决定的缓存键
  src: string; // 交给 worker 精确计数的源文
  line_count: number; // 主线程即可确定的非空行数
}

/**
 * TaskPlanner 是后台任务唯一规划器：它复用进程内 token 缓存，并把精确计数交给 planning worker。
 */
export class TaskPlanner {
  private readonly planning_worker_pool: PlanningWorkerPool; // 只做纯计算，不接触数据库和事件。
  private readonly metric_cache: TaskTokenMetricCache; // 进程内计算指标缓存，随 BackendServices 生命周期释放。

  /**
   * 注入 planning worker，规划缓存由 planner 自己持有。
   */
  public constructor(options: { planningWorkerPool: PlanningWorkerPool }) {
    this.planning_worker_pool = options.planningWorkerPool;
    this.metric_cache = new TaskTokenMetricCache();
  }

  /**
   * 构建翻译初始上下文，切块使用精确 token 指标并按模型协议准备 preceding。
   */
  public async build_translation_contexts(
    items: MutableJsonRecord[],
    config: MutableJsonRecord,
    model: MutableJsonRecord,
    signal: AbortSignal,
  ): Promise<TranslationContext[]> {
    const threshold = this.get_input_token_limit(model, DEFAULT_INPUT_TOKEN_LIMIT);
    const is_sakura = String(model["api_format"] ?? "") === "SakuraLLM"; // 纯文本响应要求单 item 且不携带 preceding。
    const chunks = await this.generate_item_chunks(
      items,
      threshold,
      is_sakura ? 0 : read_json_integer(config["preceding_lines_threshold"], 0),
      signal,
      is_sakura ? SAKURA_MAX_ITEMS_PER_WORK_UNIT : Number.POSITIVE_INFINITY,
    );
    return chunks.map(({ chunk_items, precedings }) => ({
      work_unit_id: crypto.randomUUID(),
      items: chunk_items,
      precedings,
      token_threshold: threshold,
      split_count: 0,
      retry_count: 0,
      is_initial: true,
    }));
  }

  /**
   * 翻译失败上下文先拆分，单条最多重试三次，超限条目由 Engine 标 ERROR。
   */
  public async build_translation_retry_plan(
    context: TranslationContext,
    returned_items: MutableJsonRecord[],
    retry_limit: number,
    mark_error: (item: MutableJsonRecord) => void,
    signal: AbortSignal,
  ): Promise<TranslationRetryPlan> {
    const pending_items = returned_items.filter((item) => read_task_item_status(item) === "NONE");
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
      mark_error(item);
      return { retry_contexts: [], forced_error_items: [item] };
    }
    const next_threshold = Math.max(
      1,
      Math.floor(context.token_threshold * this.get_split_factor(context.token_threshold)),
    );
    const sub_chunks = await this.generate_item_chunks(pending_items, next_threshold, 0, signal);
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
   * 构建分析上下文，checkpoint 已完成或错误的条目不会重复调度。
   */
  public async build_analysis_contexts(
    items: MutableJsonRecord[],
    checkpoints: MutableJsonRecord[],
    model: MutableJsonRecord,
    signal: AbortSignal,
  ): Promise<AnalysisContext[]> {
    const checkpoint_status_by_id = build_analysis_checkpoint_status_map(checkpoints);
    const pending_items = items
      .map((item) => this.build_analysis_item_context(item, checkpoint_status_by_id))
      .filter((item): item is AnalysisItemContext => item !== null)
      .filter((item) => item.previous_status !== "PROCESSED" && item.previous_status !== "ERROR");
    const seed_items = pending_items.map((item) => ({
      id: item.item_id,
      src: item.src_text,
      file_path: item.file_path,
      status: "NONE",
    }));
    const context_by_id = new Map(pending_items.map((item) => [item.item_id, item]));
    const chunks = await this.generate_item_chunks(
      seed_items,
      this.get_input_token_limit(model, DEFAULT_ANALYSIS_INPUT_TOKEN_LIMIT),
      0,
      signal,
    );
    return chunks
      .map(({ chunk_items }) => {
        const chunk_contexts = chunk_items
          .map((item) => context_by_id.get(read_task_item_id(item)))
          .filter((item): item is AnalysisItemContext => item !== undefined);
        return {
          work_unit_id: crypto.randomUUID(),
          file_path: chunk_contexts[0]?.file_path ?? "",
          items: chunk_contexts,
          retry_count: 0,
        };
      })
      .filter((context) => context.items.length > 0);
  }

  /**
   * 共享切块实现，只依赖 item 快照和已解析 token 指标，不在主线程执行 tokenizer。
   */
  private async generate_item_chunks(
    items: MutableJsonRecord[],
    input_token_threshold: number,
    preceding_lines_threshold: number,
    signal: AbortSignal,
    max_items_per_chunk = Number.POSITIVE_INFINITY, // 普通模型不设上限，纯文本协议按 item 边界收敛。
  ): Promise<Array<{ chunk_items: MutableJsonRecord[]; precedings: MutableJsonRecord[] }>> {
    const metric_by_id = await this.resolve_item_metrics(items, signal);
    const line_limit = Math.max(8, Math.trunc(input_token_threshold / 16));
    const chunks: Array<{ chunk_items: MutableJsonRecord[]; precedings: MutableJsonRecord[] }> = [];
    let skipped_count = 0;
    let line_length = 0;
    let token_length = 0;
    let chunk: MutableJsonRecord[] = [];
    for (const [index, item] of items.entries()) {
      this.throw_if_aborted(signal);
      if (read_task_item_status(item) !== "NONE") {
        skipped_count += 1;
        continue;
      }
      const metric = metric_by_id.get(read_task_item_id(item));
      if (metric === undefined) {
        skipped_count += 1;
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
            index,
            skipped_count,
            preceding_lines_threshold,
          ),
        });
        skipped_count = 0;
        line_length = 0;
        token_length = 0;
        chunk = [];
      }
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
          items.length,
          skipped_count,
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
    items: MutableJsonRecord[],
    signal: AbortSignal,
  ): Promise<Map<number, TaskTokenMetric>> {
    const seeds = await this.build_metric_seeds(items, signal);
    const metric_by_id = new Map<number, TaskTokenMetric>();
    const missing_by_key = new Map<string, TaskTokenCountInput>();
    for (const seed of seeds) {
      const cached_metric = this.metric_cache.get(seed.cache_key);
      if (cached_metric !== null) {
        metric_by_id.set(seed.item_id, cached_metric);
        continue;
      }
      missing_by_key.set(seed.cache_key, { cache_key: seed.cache_key, text: seed.src });
    }
    if (missing_by_key.size > 0) {
      await this.count_missing_metrics([...missing_by_key.values()], seeds, metric_by_id, signal);
    }
    return metric_by_id;
  }

  /**
   * 批量调用 planning worker，并把结果写入进程内 cache 后回填本次规划所需指标。
   */
  private async count_missing_metrics(
    missing_inputs: TaskTokenCountInput[],
    seeds: MetricSeed[],
    metric_by_id: Map<number, TaskTokenMetric>,
    signal: AbortSignal,
  ): Promise<void> {
    const results = await this.planning_worker_pool.count_items(missing_inputs, signal);
    const token_count_by_key = new Map(
      results.map((result) => [result.cache_key, result.token_count]),
    );
    for (const seed of seeds) {
      if (metric_by_id.has(seed.item_id)) {
        continue;
      }
      const token_count = token_count_by_key.get(seed.cache_key);
      if (token_count === undefined) {
        continue;
      }
      const metric = { token_count, line_count: seed.line_count };
      this.metric_cache.set(seed.cache_key, metric);
      metric_by_id.set(seed.item_id, metric);
    }
  }

  /**
   * 构建 cache 校验种子；hash 计算留在主线程但分批让出，避免大项目启动阶段长卡顿。
   */
  private async build_metric_seeds(
    items: MutableJsonRecord[],
    signal: AbortSignal,
  ): Promise<MetricSeed[]> {
    const seeds: MetricSeed[] = [];
    const seen_item_ids = new Set<number>();
    for (const [index, item] of items.entries()) {
      this.throw_if_aborted(signal);
      if (read_task_item_status(item) !== "NONE") {
        continue;
      }
      const item_id = read_task_item_id(item);
      if (item_id <= 0 || seen_item_ids.has(item_id)) {
        continue;
      }
      seen_item_ids.add(item_id);
      const raw_src = String(item["src"] ?? "");
      // token 指标使用短投影，行数仍以原文为准，避免资源载荷改变切块成本。
      const src = project_text_resource_references(raw_src).text;
      seeds.push({
        item_id,
        cache_key: build_task_token_metric_cache_key(src),
        src,
        line_count: count_non_empty_source_lines(raw_src),
      });
      if (index > 0 && index % HASH_YIELD_EVERY_ITEMS === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
    return seeds;
  }

  /**
   * 生成翻译上文块，边界跟随文件路径和句末标点。
   */
  private generate_preceding_chunk(
    items: MutableJsonRecord[],
    chunk: MutableJsonRecord[],
    start: number,
    skipped_count: number,
    preceding_lines_threshold: number,
  ): MutableJsonRecord[] {
    const result: MutableJsonRecord[] = [];
    const current_file_path = String(chunk[chunk.length - 1]?.["file_path"] ?? "");
    for (let index = start - skipped_count - chunk.length - 1; index >= 0; index -= 1) {
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
   * 从 item 和 checkpoint map 构建不可变分析输入快照。
   */
  private build_analysis_item_context(
    item: MutableJsonRecord,
    checkpoint_status_by_id: Map<number, string>,
  ): AnalysisItemContext | null {
    if (!is_analyzable_task_item(item)) {
      return null;
    }
    const item_id = read_task_item_id(item);
    if (item_id <= 0) {
      return null;
    }
    return {
      item_id,
      file_path: String(item["file_path"] ?? ""),
      src_text: this.build_analysis_source_text(item),
      previous_status: checkpoint_status_by_id.get(item_id) ?? null,
    };
  }

  /**
   * 分析输入在规划期渲染姓名前缀，后续 worker 继续只消费纯文本快照。
   */
  private build_analysis_source_text(item: MutableJsonRecord): string {
    const src = remove_text_resource_references(String(item["src"] ?? "")).trim();
    if (src === "") {
      return "";
    }
    const name = remove_text_resource_references(read_item_name_text(item["name_src"])).trim();
    return name === "" ? src : `【${name}】${src}`;
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
    const threshold = { ...read_json_record(model["threshold"]) };
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
