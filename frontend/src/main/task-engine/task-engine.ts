import crypto from "node:crypto";

import type { LogManager } from "../log/log-manager";
import { resolve_active_model } from "../model/model-config-resolver";
import type { ConfigService } from "../service/config-service";
import type { ApiJsonValue } from "../api/api-types";
import type { JsonRecord, MutableJsonRecord, TaskType } from "../task/task-types";
import { TaskDataService } from "../task/task-data-service";
import { TaskEventHub } from "../task/task-event-hub";
import { TaskRuntimeState } from "../task/task-runtime-state";
import { TaskSnapshotBuilder } from "../task/task-snapshot-builder";
import {
  WorkUnitExecutorTransportError,
  type TaskWorkUnitExecutor,
} from "../task-worker/task-work-unit-executor";
import type {
  AnalysisWorkUnitResult,
  TaskItemRecord,
  TaskProgressSnapshot,
  TaskRunHandle,
  TranslationWorkUnitResult,
} from "./task-engine-types";
import { TaskLimiter } from "./task-limiter";
import { TaskPipeline } from "./task-pipeline";
import { TaskProgressSnapshotTool } from "./task-progress-snapshot";
import { TaskRunLock } from "./task-run-lock";

// 翻译终态只认已处理和错误，跳过类状态不参与重试终结判断。
const TRANSLATION_TERMINAL_STATUSES = new Set(["PROCESSED", "ERROR"]);

// 跳过状态来自公开 item status，TaskEngine 不再把这些条目派发给 worker。
const TRANSLATION_SKIPPED_STATUSES = new Set([
  "EXCLUDED",
  "RULE_SKIPPED",
  "LANGUAGE_SKIPPED",
  "DUPLICATED",
]);

// 分析和翻译共享跳过语义，避免同一 item 状态被两个任务解释出不同结果。
const ANALYSIS_SKIPPED_STATUSES = TRANSLATION_SKIPPED_STATUSES;

// 翻译重试次数高于分析，因为翻译支持拆分重试，分析只按 chunk 重试。
const TRANSLATION_RETRY_LIMIT = 3;
// 分析失败只重发同一 chunk，过多重试会阻塞后续文件 checkpoint。
const ANALYSIS_RETRY_LIMIT = 2;

// 模型未配置 token 限制时使用保守默认值，避免一次塞入过长 prompt。
const DEFAULT_INPUT_TOKEN_LIMIT = 512;
// 分析 prompt 额外包含术语抽取说明，默认 token 门槛与翻译保持一致但独立调参。
const DEFAULT_ANALYSIS_INPUT_TOKEN_LIMIT = 512;

// chunk 拆分优先在句末标点处分割，减少上下文被硬切断的概率。
const END_LINE_PUNCTUATION = new Set([".", "。", "?", "？", "!", "！", "…", "'", '"', "」", "』"]);

// TaskEngine 依赖都从 Gateway 注入，保证后台任务只通过固定端口读写工程事实。
interface TaskEngineOptions {
  taskDataService: TaskDataService;
  taskRuntimeState: TaskRuntimeState;
  eventHub: TaskEventHub;
  executorClient: TaskWorkUnitExecutor;
  configService: ConfigService;
  snapshotBuilder: TaskSnapshotBuilder;
  logManager: LogManager;
}

// 一次任务启动时冻结配置和模型，运行中不跟随设置页热变更。
interface TaskRuntimeSnapshot {
  config_snapshot: MutableJsonRecord;
  model: MutableJsonRecord;
}

// 翻译 context 是 pipeline 的最小工作单元，包含 chunk、preceding 与重试元信息。
interface TranslationContext {
  work_unit_id: string;
  items: TaskItemRecord[];
  precedings: TaskItemRecord[];
  token_threshold: number;
  split_count: number;
  retry_count: number;
  is_initial: boolean;
}

// 翻译提交项只携带可批量写库的数据和 token 累计值。
interface TranslationCommitEntry {
  items: TaskItemRecord[];
  input_tokens: number;
  output_tokens: number;
}

// 拆分重试会同时产生新 context 和强制失败条目，两者必须分开提交。
interface TranslationRetryPlan {
  retry_contexts: TranslationContext[];
  forced_error_items: TaskItemRecord[];
}

// 分析 item 上下文不传完整 item，防止 worker 误写非分析字段。
interface AnalysisItemContext {
  item_id: number;
  file_path: string;
  src_text: string;
  first_name_src: string | null;
  previous_status: string | null;
}

// 分析 context 按文件路径聚合，日志和候选 first_seen_index 都依赖稳定顺序。
interface AnalysisContext {
  work_unit_id: string;
  file_path: string;
  items: AnalysisItemContext[];
  retry_count: number;
}

// 分析提交项把 checkpoint、候选和进度 delta 分开，避免提交时再次推导。
interface AnalysisCommitEntry {
  success_checkpoints: MutableJsonRecord[];
  error_checkpoints: MutableJsonRecord[];
  glossary_entries: MutableJsonRecord[];
  input_tokens: number;
  output_tokens: number;
  processed_delta: number;
  error_delta: number;
}

/**
 * Electron main 的后台任务执行权威，持有生命周期、调度、限流、停止、重试和提交循环。
 */
export class TaskEngine {
  // task_data_service 是后台任务唯一项目数据写入口，TaskEngine 不直接碰 database。
  private readonly task_data_service: TaskDataService;
  private readonly task_runtime_state: TaskRuntimeState;
  private readonly event_hub: TaskEventHub;
  // executor_client 屏蔽 worker_threads / direct runner 差异，主流程只关心 work-unit 结果。
  private readonly executor_client: TaskWorkUnitExecutor;
  private readonly config_service: ConfigService;
  private readonly snapshot_builder: TaskSnapshotBuilder;
  private readonly log_manager: LogManager;
  // run_lock 是整场任务互斥与停止信号的唯一权威。
  private readonly run_lock = new TaskRunLock();
  // request_in_flight_count 只表达实时网络压力，不落库也不参与恢复。
  private request_in_flight_count = 0;

  /**
   * 注入任务执行依赖，保证任务数据写入口和 work-unit executor 边界可测试。
   */
  public constructor(options: TaskEngineOptions) {
    this.task_data_service = options.taskDataService;
    this.task_runtime_state = options.taskRuntimeState;
    this.event_hub = options.eventHub;
    this.executor_client = options.executorClient;
    this.config_service = options.configService;
    this.snapshot_builder = options.snapshotBuilder;
    this.log_manager = options.logManager;
  }

  /**
   * 启动翻译后台任务；方法只完成排队受理，真实执行在后台 promise 中收尾。
   */
  public async start_translation(mode: string, quality_snapshot: ApiJsonValue): Promise<void> {
    const handle = this.run_lock.begin("translation");
    void this.run_translation(handle, mode, quality_snapshot);
  }

  /**
   * 请求停止翻译任务；停止事件由 TS 本地发布并向 work unit 传播 abort。
   */
  public async stop_translation(): Promise<void> {
    this.request_stop("translation");
  }

  /**
   * 启动分析后台任务，TS 负责 reset / checkpoint / commit 全链路。
   */
  public async start_analysis(mode: string, quality_snapshot: ApiJsonValue): Promise<void> {
    const handle = this.run_lock.begin("analysis");
    void this.run_analysis(handle, mode, quality_snapshot);
  }

  /**
   * 请求停止分析任务；已发 work unit 超时或返回后由 run_id 隔离。
   */
  public async stop_analysis(): Promise<void> {
    this.request_stop("analysis");
  }

  /**
   * 启动批量重翻任务，TS 持有 item 队列、提交和行级 busy patch。
   */
  public async start_retranslate(
    item_ids: number[],
    quality_snapshot: ApiJsonValue,
  ): Promise<void> {
    const handle = this.run_lock.begin("retranslate");
    void this.run_retranslate(handle, item_ids, quality_snapshot);
  }

  /**
   * 单条翻译不占后台全局锁，只走 work-unit executor 并保持公开响应形状。
   */
  public async translate_single(text: string): Promise<MutableJsonRecord> {
    const runtime = this.resolve_runtime_snapshot();
    const run_id = crypto.randomUUID();
    const response = await this.executor_client.translate_single(
      {
        run_id,
        work_unit_id: "single",
        task_type: "translate-single",
        model: runtime.model as unknown as ApiJsonValue,
        config_snapshot: runtime.config_snapshot as unknown as ApiJsonValue,
        quality_snapshot: null,
        text,
      },
      new AbortController().signal,
    );
    this.emit_work_unit_logs(response.logs);
    const { logs: _logs, ...public_response } = response;
    return public_response;
  }

  /**
   * 统一处理停止请求，保证 runtime state 和公开事件流同步进入 STOPPING。
   */
  private request_stop(task_type: TaskType): void {
    if (!this.run_lock.request_stop(task_type)) {
      return;
    }
    this.event_hub.publish("task.status_changed", {
      task_type,
      status: "STOPPING",
      busy: true,
    });
  }

  /**
   * 翻译主流程：取数据、切块、限流执行、批量提交并发布最终 task patch。
   */
  private async run_translation(
    handle: TaskRunHandle,
    mode: string,
    quality_snapshot: ApiJsonValue,
  ): Promise<void> {
    let final_status = "DONE";
    try {
      this.emit_status(handle.task_type, "RUN", true);
      const runtime = this.resolve_runtime_snapshot();
      this.log_task_run_start("翻译任务", runtime.model);
      const payload = this.task_data_service.get_translation_items({ mode });
      const all_items = this.normalize_record_list(payload["items"]);
      const meta = this.normalize_record(payload["meta"]);
      const contexts = this.build_translation_contexts(
        all_items,
        runtime.config_snapshot,
        runtime.model,
      );
      let progress = this.build_translation_progress(mode, all_items, meta);
      this.emit_progress(handle.task_type, progress);
      const limiter = this.build_limiter(runtime.model);
      const pipeline = new TaskPipeline<TranslationContext, TranslationCommitEntry>({
        worker_count: limiter.max_concurrency,
        signal: handle.signal,
        execute: (context, signal) =>
          this.execute_translation_context(
            handle,
            context,
            runtime,
            quality_snapshot,
            limiter,
            signal,
          ),
        commit: async (entries) => {
          progress = await this.commit_translation_entries(handle, entries, progress);
        },
      });
      await pipeline.run(contexts);
      if (handle.signal.aborted) {
        final_status = "IDLE";
      }
      progress = TaskProgressSnapshotTool.with_elapsed(progress);
      await this.update_translation_progress_if_current(handle, progress);
    } catch (error) {
      final_status = handle.signal.aborted ? "IDLE" : "ERROR";
      if (!handle.signal.aborted) {
        this.log_task_error("TS 翻译任务执行失败。", error);
      }
    } finally {
      this.log_task_run_finish("翻译任务", final_status);
      await this.finish_run(handle, final_status);
    }
  }

  /**
   * 分析主流程：TS 解释 checkpoint，work unit 只负责单个 chunk 请求。
   */
  private async run_analysis(
    handle: TaskRunHandle,
    mode: string,
    quality_snapshot: ApiJsonValue,
  ): Promise<void> {
    let final_status = "DONE";
    try {
      this.emit_status(handle.task_type, "RUN", true);
      const runtime = this.resolve_runtime_snapshot();
      this.log_task_run_start("分析任务", runtime.model);
      if (mode === "NEW" || mode === "RESET") {
        this.task_data_service.reset_analysis_progress({});
      }
      const payload = this.task_data_service.get_analysis_context({});
      const all_items = this.normalize_record_list(payload["items"]);
      const checkpoints = this.normalize_record_list(payload["checkpoints"]);
      const meta = this.normalize_record(payload["meta"]);
      const contexts = this.build_analysis_contexts(all_items, checkpoints, runtime.model);
      let progress = this.build_analysis_progress(mode, all_items, checkpoints, meta);
      this.emit_progress(handle.task_type, progress);
      const limiter = this.build_limiter(runtime.model);
      const pipeline = new TaskPipeline<AnalysisContext, AnalysisCommitEntry>({
        worker_count: limiter.max_concurrency,
        signal: handle.signal,
        execute: (context, signal) =>
          this.execute_analysis_context(
            handle,
            context,
            runtime,
            quality_snapshot,
            limiter,
            signal,
          ),
        commit: async (entries) => {
          progress = await this.commit_analysis_entries(handle, entries, progress);
        },
      });
      await pipeline.run(contexts);
      if (handle.signal.aborted) {
        final_status = "IDLE";
      }
      progress = TaskProgressSnapshotTool.with_elapsed(progress);
      await this.update_analysis_progress_if_current(handle, progress);
    } catch (error) {
      final_status = handle.signal.aborted ? "IDLE" : "ERROR";
      if (!handle.signal.aborted) {
        this.log_task_error("TS 分析任务执行失败。", error);
      }
    } finally {
      this.log_task_run_finish("分析任务", final_status);
      await this.finish_run(handle, final_status);
    }
  }

  /**
   * 重翻主流程：每个 item 是一个 work unit，提交后由 TaskDataService 推进 proofreading patch。
   */
  private async run_retranslate(
    handle: TaskRunHandle,
    item_ids: number[],
    quality_snapshot: ApiJsonValue,
  ): Promise<void> {
    let final_status = "DONE";
    try {
      this.emit_status(handle.task_type, "RUN", true);
      const runtime = this.resolve_runtime_snapshot();
      this.log_task_run_start("重翻任务", runtime.model);
      const payload = this.task_data_service.get_retranslate_items({
        item_ids: item_ids as unknown as ApiJsonValue,
      });
      const items = this.normalize_record_list(payload["items"]);
      const meta = this.normalize_record(payload["meta"]);
      let progress = this.build_retranslate_progress(items, meta);
      this.emit_progress(handle.task_type, progress);
      const limiter = this.build_limiter(runtime.model);
      const contexts = items.map((item) => this.build_retranslate_context(item));
      const pipeline = new TaskPipeline<TranslationContext, TranslationCommitEntry>({
        worker_count: limiter.max_concurrency,
        signal: handle.signal,
        execute: (context, signal) =>
          this.execute_retranslate_context(
            handle,
            context,
            runtime,
            quality_snapshot,
            limiter,
            signal,
          ),
        commit: async (entries) => {
          progress = await this.commit_retranslate_entries(handle, entries, progress);
        },
      });
      await pipeline.run(contexts);
      if (handle.signal.aborted) {
        final_status = "IDLE";
      }
    } catch (error) {
      final_status = handle.signal.aborted ? "IDLE" : "ERROR";
      if (!handle.signal.aborted) {
        this.log_task_error("TS 重翻任务执行失败。", error);
      }
    } finally {
      this.log_task_run_finish("重翻任务", final_status);
      await this.finish_run(handle, final_status);
    }
  }

  /**
   * 执行翻译 chunk，并把失败条目转换成高优重试上下文。
   */
  private async execute_translation_context(
    handle: TaskRunHandle,
    context: TranslationContext,
    runtime: TaskRuntimeSnapshot,
    quality_snapshot: ApiJsonValue,
    limiter: TaskLimiter,
    signal: AbortSignal,
  ) {
    const result = await this.call_translation_executor_with_retryable_transport(
      context,
      handle,
      signal,
      limiter,
      () =>
        this.executor_client.execute_translation_chunk(
          {
            run_id: handle.run_id,
            work_unit_id: context.work_unit_id,
            task_type: "translation",
            model: runtime.model as unknown as ApiJsonValue,
            config_snapshot: runtime.config_snapshot as unknown as ApiJsonValue,
            quality_snapshot,
            items: context.items as unknown as ApiJsonValue,
            precedings: context.precedings as unknown as ApiJsonValue,
            split_count: context.split_count,
            retry_count: context.retry_count,
            token_threshold: context.token_threshold,
            is_initial: context.is_initial,
          },
          signal,
        ),
    );
    this.emit_work_unit_logs(result.logs);
    return this.build_translation_worker_result(context, result);
  }

  /**
   * 执行分析 chunk，失败会按固定次数重试，最终失败才写 ERROR checkpoint。
   */
  private async execute_analysis_context(
    handle: TaskRunHandle,
    context: AnalysisContext,
    runtime: TaskRuntimeSnapshot,
    quality_snapshot: ApiJsonValue,
    limiter: TaskLimiter,
    signal: AbortSignal,
  ) {
    const result = await this.call_with_limiter(handle, limiter, signal, () =>
      this.executor_client.execute_analysis_chunk(
        {
          run_id: handle.run_id,
          work_unit_id: context.work_unit_id,
          task_type: "analysis",
          model: runtime.model as unknown as ApiJsonValue,
          config_snapshot: runtime.config_snapshot as unknown as ApiJsonValue,
          quality_snapshot,
          context: this.analysis_context_to_payload(context) as unknown as ApiJsonValue,
        },
        signal,
      ),
    );
    this.emit_work_unit_logs(result.logs);
    return this.build_analysis_worker_result(context, result);
  }

  /**
   * 执行单条重翻，失败时由 TS 直接构造 ERROR item，避免 worker 持有提交权。
   */
  private async execute_retranslate_context(
    handle: TaskRunHandle,
    context: TranslationContext,
    runtime: TaskRuntimeSnapshot,
    quality_snapshot: ApiJsonValue,
    limiter: TaskLimiter,
    signal: AbortSignal,
  ) {
    const result = await this.call_translation_executor_with_retryable_transport(
      context,
      handle,
      signal,
      limiter,
      () =>
        this.executor_client.execute_retranslate_item(
          {
            run_id: handle.run_id,
            work_unit_id: context.work_unit_id,
            task_type: "retranslate",
            model: runtime.model as unknown as ApiJsonValue,
            config_snapshot: runtime.config_snapshot as unknown as ApiJsonValue,
            quality_snapshot,
            item: context.items[0] as unknown as ApiJsonValue,
          },
          signal,
        ),
    );
    this.emit_work_unit_logs(result.logs);
    if (result.items.length === 0 && result.row_count === 0) {
      return this.build_translation_worker_result(context, result);
    }
    const items = this.ensure_retranslate_terminal_item(context.items[0], result);
    return {
      commit_entries: [
        { items, input_tokens: result.input_tokens, output_tokens: result.output_tokens },
      ],
      retry_contexts: [],
    };
  }

  /**
   * executor 网络抖动只让当前 chunk 进入翻译重试计划，不能中止整场任务和丢弃其它完成结果。
   */
  private async call_translation_executor_with_retryable_transport(
    context: TranslationContext,
    handle: TaskRunHandle,
    signal: AbortSignal,
    limiter: TaskLimiter,
    callback: () => Promise<TranslationWorkUnitResult>,
  ): Promise<TranslationWorkUnitResult> {
    try {
      return await this.call_with_limiter(handle, limiter, signal, callback);
    } catch (error) {
      if (signal.aborted || !(error instanceof WorkUnitExecutorTransportError)) {
        throw error;
      }
      return {
        items: context.items,
        row_count: 0,
        input_tokens: 0,
        output_tokens: 0,
        stopped: false,
      };
    }
  }

  /**
   * 带限流执行 work unit 请求，同时维护 TS 侧真实 request_in_flight_count。
   */
  private async call_with_limiter<T>(
    handle: TaskRunHandle,
    limiter: TaskLimiter,
    signal: AbortSignal,
    callback: () => Promise<T>,
  ): Promise<T> {
    const release = await limiter.acquire(signal);
    this.change_request_in_flight_count(handle.task_type, 1);
    try {
      return await callback();
    } finally {
      this.change_request_in_flight_count(handle.task_type, -1);
      release();
    }
  }

  /**
   * 翻译 worker 结果拆成可提交终态 items 与需要重试的上下文。
   */
  private build_translation_worker_result(
    context: TranslationContext,
    result: TranslationWorkUnitResult,
  ) {
    if (result.stopped) {
      return { commit_entries: [], retry_contexts: [] };
    }
    const returned_items = result.items.length > 0 ? result.items : context.items;
    const terminal_items = returned_items.filter((item) =>
      TRANSLATION_TERMINAL_STATUSES.has(this.read_status(item)),
    );
    const retry_plan = this.build_translation_retry_plan(context, returned_items);
    const commit_items = [...terminal_items, ...retry_plan.forced_error_items];
    return {
      commit_entries:
        commit_items.length > 0
          ? [
              {
                items: commit_items,
                input_tokens: result.input_tokens,
                output_tokens: result.output_tokens,
              },
            ]
          : [],
      retry_contexts: retry_plan.retry_contexts,
    };
  }

  /**
   * 分析 worker 结果转换为 checkpoint、候选和 token 提交载荷。
   */
  private build_analysis_worker_result(context: AnalysisContext, result: AnalysisWorkUnitResult) {
    if (result.stopped) {
      return { commit_entries: [], retry_contexts: [] };
    }
    if (result.success) {
      return {
        commit_entries: [
          {
            success_checkpoints: this.build_analysis_checkpoints(context, "PROCESSED"),
            error_checkpoints: [],
            glossary_entries: result.glossary_entries,
            input_tokens: result.input_tokens,
            output_tokens: result.output_tokens,
            processed_delta: context.items.length,
            error_delta: 0,
          },
        ],
        retry_contexts: [],
      };
    }
    if (context.retry_count < ANALYSIS_RETRY_LIMIT) {
      return {
        commit_entries: [
          {
            success_checkpoints: [],
            error_checkpoints: [],
            glossary_entries: [],
            input_tokens: result.input_tokens,
            output_tokens: result.output_tokens,
            processed_delta: 0,
            error_delta: 0,
          },
        ],
        retry_contexts: [
          { ...context, work_unit_id: crypto.randomUUID(), retry_count: context.retry_count + 1 },
        ],
      };
    }
    return {
      commit_entries: [
        {
          success_checkpoints: [],
          error_checkpoints: this.build_analysis_checkpoints(context, "ERROR"),
          glossary_entries: [],
          input_tokens: result.input_tokens,
          output_tokens: result.output_tokens,
          processed_delta: 0,
          error_delta: context.items.length,
        },
      ],
      retry_contexts: [],
    };
  }

  /**
   * 提交翻译批次并推进持久进度；迟到 run 不允许写入。
   */
  private async commit_translation_entries(
    handle: TaskRunHandle,
    entries: TranslationCommitEntry[],
    progress: TaskProgressSnapshot,
  ): Promise<TaskProgressSnapshot> {
    if (!this.run_lock.is_current(handle.run_id) || entries.length === 0) {
      return progress;
    }
    const items = entries.flatMap((entry) => entry.items);
    const processed_delta = items.filter((item) => this.read_status(item) === "PROCESSED").length;
    const error_delta = items.filter((item) => this.read_status(item) === "ERROR").length;
    let next_progress = TaskProgressSnapshotTool.with_counts(progress, {
      processed_line: progress.processed_line + processed_delta,
      error_line: progress.error_line + error_delta,
    });
    for (const entry of entries) {
      next_progress = TaskProgressSnapshotTool.add_tokens(
        next_progress,
        entry.input_tokens,
        entry.output_tokens,
      );
    }
    next_progress = TaskProgressSnapshotTool.with_elapsed(next_progress);
    this.task_data_service.commit_translation_batch({
      items: items as unknown as ApiJsonValue,
      translation_extras: TaskProgressSnapshotTool.to_record(
        next_progress,
      ) as unknown as ApiJsonValue,
    });
    this.emit_progress(handle.task_type, next_progress);
    return next_progress;
  }

  /**
   * 提交分析批次，候选聚合和 checkpoint 写入仍走 TaskDataService。
   */
  private async commit_analysis_entries(
    handle: TaskRunHandle,
    entries: AnalysisCommitEntry[],
    progress: TaskProgressSnapshot,
  ): Promise<TaskProgressSnapshot> {
    if (!this.run_lock.is_current(handle.run_id) || entries.length === 0) {
      return progress;
    }
    let next_progress = progress;
    for (const entry of entries) {
      next_progress = TaskProgressSnapshotTool.add_tokens(
        next_progress,
        entry.input_tokens,
        entry.output_tokens,
      );
      next_progress = TaskProgressSnapshotTool.with_counts(next_progress, {
        processed_line: next_progress.processed_line + entry.processed_delta,
        error_line: next_progress.error_line + entry.error_delta,
      });
    }
    next_progress = TaskProgressSnapshotTool.with_elapsed(next_progress);
    this.task_data_service.commit_analysis_batch({
      success_checkpoints: entries.flatMap(
        (entry) => entry.success_checkpoints,
      ) as unknown as ApiJsonValue,
      error_checkpoints: entries.flatMap(
        (entry) => entry.error_checkpoints,
      ) as unknown as ApiJsonValue,
      glossary_entries: entries.flatMap(
        (entry) => entry.glossary_entries,
      ) as unknown as ApiJsonValue,
      progress_snapshot: TaskProgressSnapshotTool.to_record(
        next_progress,
      ) as unknown as ApiJsonValue,
    });
    this.emit_progress(handle.task_type, next_progress);
    return next_progress;
  }

  /**
   * 提交重翻结果，TaskDataService 会同步推进 items、proofreading 和 task patch。
   */
  private async commit_retranslate_entries(
    handle: TaskRunHandle,
    entries: TranslationCommitEntry[],
    progress: TaskProgressSnapshot,
  ): Promise<TaskProgressSnapshot> {
    if (!this.run_lock.is_current(handle.run_id) || entries.length === 0) {
      return progress;
    }
    const items = entries.flatMap((entry) => entry.items);
    const processed_delta = items.filter((item) => this.read_status(item) === "PROCESSED").length;
    const error_delta = items.filter((item) => this.read_status(item) === "ERROR").length;
    let next_progress = TaskProgressSnapshotTool.with_counts(progress, {
      processed_line: progress.processed_line + processed_delta,
      error_line: progress.error_line + error_delta,
    });
    for (const entry of entries) {
      next_progress = TaskProgressSnapshotTool.add_tokens(
        next_progress,
        entry.input_tokens,
        entry.output_tokens,
      );
    }
    next_progress = TaskProgressSnapshotTool.with_elapsed(next_progress);
    this.task_data_service.commit_retranslate_batch({
      items: items as unknown as ApiJsonValue,
      translation_extras: TaskProgressSnapshotTool.to_record(
        next_progress,
      ) as unknown as ApiJsonValue,
    });
    this.emit_progress(handle.task_type, next_progress);
    return next_progress;
  }

  /**
   * 构建翻译初始上下文，切块规则沿用旧 Python TaskScheduler 的边界。
   */
  private build_translation_contexts(
    items: TaskItemRecord[],
    config: MutableJsonRecord,
    model: MutableJsonRecord,
  ): TranslationContext[] {
    const threshold = this.get_input_token_limit(model, DEFAULT_INPUT_TOKEN_LIMIT);
    const chunks = this.generate_item_chunks(
      items,
      threshold,
      this.read_number(config["preceding_lines_threshold"], 0),
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
   * 翻译失败上下文按旧语义先拆分，单条最多重试三次，超限标 ERROR。
   */
  private build_translation_retry_plan(
    context: TranslationContext,
    returned_items: TaskItemRecord[],
  ): TranslationRetryPlan {
    const pending_items = returned_items.filter((item) => this.read_status(item) === "NONE");
    if (pending_items.length === 0) {
      return { retry_contexts: [], forced_error_items: [] };
    }
    if (pending_items.length === 1) {
      const item = pending_items[0] as TaskItemRecord;
      if (context.retry_count < TRANSLATION_RETRY_LIMIT) {
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
      this.force_accept_translation_item(item);
      return { retry_contexts: [], forced_error_items: [item] };
    }
    const next_threshold = Math.max(
      1,
      Math.floor(context.token_threshold * this.get_split_factor(context.token_threshold)),
    );
    const sub_chunks = this.generate_item_chunks(pending_items, next_threshold, 0);
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
  private build_analysis_contexts(
    items: TaskItemRecord[],
    checkpoints: MutableJsonRecord[],
    model: MutableJsonRecord,
  ): AnalysisContext[] {
    const checkpoint_status_by_id = this.build_checkpoint_status_map(checkpoints);
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
    return this.generate_item_chunks(
      seed_items,
      this.get_input_token_limit(model, DEFAULT_ANALYSIS_INPUT_TOKEN_LIMIT),
      0,
    )
      .map(({ chunk_items }) => {
        const chunk_contexts = chunk_items
          .map((item) => context_by_id.get(this.read_item_id(item)))
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
   * 重翻每个 item 独立执行，保持行级 busy patch 能逐条收敛。
   */
  private build_retranslate_context(item: TaskItemRecord): TranslationContext {
    return {
      work_unit_id: crypto.randomUUID(),
      items: [item],
      precedings: [],
      token_threshold: DEFAULT_INPUT_TOKEN_LIMIT,
      split_count: 0,
      retry_count: 0,
      is_initial: true,
    };
  }

  /**
   * 共享切块实现，只依赖 item 快照，不读取数据库或 Python 对象。
   */
  private generate_item_chunks(
    items: TaskItemRecord[],
    input_token_threshold: number,
    preceding_lines_threshold: number,
  ): Array<{ chunk_items: TaskItemRecord[]; precedings: TaskItemRecord[] }> {
    const line_limit = Math.max(8, Math.trunc(input_token_threshold / 16));
    const chunks: Array<{ chunk_items: TaskItemRecord[]; precedings: TaskItemRecord[] }> = [];
    let skipped_count = 0;
    let line_length = 0;
    let token_length = 0;
    let chunk: TaskItemRecord[] = [];
    for (const [index, item] of items.entries()) {
      if (this.read_status(item) !== "NONE") {
        skipped_count += 1;
        continue;
      }
      const current_line_length = this.count_non_empty_lines(String(item["src"] ?? ""));
      const current_token_length = this.estimate_token_count(String(item["src"] ?? ""));
      if (
        chunk.length > 0 &&
        (line_length + current_line_length > line_limit ||
          token_length + current_token_length > input_token_threshold ||
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
      line_length += current_line_length;
      token_length += current_token_length;
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
   * 生成翻译上文块，边界跟随文件路径和句末标点。
   */
  private generate_preceding_chunk(
    items: TaskItemRecord[],
    chunk: TaskItemRecord[],
    start: number,
    skipped_count: number,
    preceding_lines_threshold: number,
  ): TaskItemRecord[] {
    const result: TaskItemRecord[] = [];
    const current_file_path = String(chunk[chunk.length - 1]?.["file_path"] ?? "");
    for (let index = start - skipped_count - chunk.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (item === undefined || TRANSLATION_SKIPPED_STATUSES.has(this.read_status(item))) {
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
   * 根据任务模式和当前 item 状态创建翻译进度初始值。
   */
  private build_translation_progress(
    mode: string,
    items: TaskItemRecord[],
    meta: MutableJsonRecord,
  ): TaskProgressSnapshot {
    const total_line = items.filter(
      (item) => !TRANSLATION_SKIPPED_STATUSES.has(this.read_status(item)),
    ).length;
    const processed_line = items.filter((item) => this.read_status(item) === "PROCESSED").length;
    const error_line = items.filter((item) => this.read_status(item) === "ERROR").length;
    const previous =
      mode === "CONTINUE"
        ? TaskProgressSnapshotTool.from_record(meta["translation_extras"])
        : TaskProgressSnapshotTool.empty();
    return TaskProgressSnapshotTool.with_counts(
      {
        ...previous,
        start_time:
          mode === "CONTINUE" && previous.time > 0
            ? Date.now() / 1000 - previous.time
            : Date.now() / 1000,
      },
      { total_line, processed_line, error_line },
    );
  }

  /**
   * 根据 checkpoint 和 meta 创建分析进度初始值。
   */
  private build_analysis_progress(
    mode: string,
    items: TaskItemRecord[],
    checkpoints: MutableJsonRecord[],
    meta: MutableJsonRecord,
  ): TaskProgressSnapshot {
    const checkpoint_status_by_id = this.build_checkpoint_status_map(checkpoints);
    const analyzable_items = items.filter((item) => this.is_analyzable_item(item));
    const processed_line = analyzable_items.filter(
      (item) => checkpoint_status_by_id.get(this.read_item_id(item)) === "PROCESSED",
    ).length;
    const error_line = analyzable_items.filter(
      (item) => checkpoint_status_by_id.get(this.read_item_id(item)) === "ERROR",
    ).length;
    const previous =
      mode === "CONTINUE"
        ? TaskProgressSnapshotTool.from_record(meta["analysis_extras"])
        : TaskProgressSnapshotTool.empty();
    return TaskProgressSnapshotTool.with_counts(
      {
        ...previous,
        start_time:
          mode === "CONTINUE" && previous.time > 0
            ? Date.now() / 1000 - previous.time
            : Date.now() / 1000,
      },
      { total_line: analyzable_items.length, processed_line, error_line },
    );
  }

  /**
   * 重翻进度复用 translation_extras 的 token 累计，但本轮行数只看选中条目。
   */
  private build_retranslate_progress(
    items: TaskItemRecord[],
    meta: MutableJsonRecord,
  ): TaskProgressSnapshot {
    const previous = TaskProgressSnapshotTool.from_record(meta["translation_extras"]);
    return TaskProgressSnapshotTool.with_counts(
      { ...previous, start_time: Date.now() / 1000 },
      { total_line: items.length, processed_line: 0, error_line: 0 },
    );
  }

  /**
   * 运行结束后发布终态，并补一帧 replace_task patch 给 ProjectStore。
   */
  private async finish_run(handle: TaskRunHandle, status: string): Promise<void> {
    const still_current = this.run_lock.is_current(handle.run_id);
    this.request_in_flight_count = 0;
    if (still_current) {
      this.emit_status(handle.task_type, status, false);
      this.run_lock.finish(handle.run_id);
      await this.publish_task_patch(handle.task_type);
    }
  }

  /**
   * 翻译结束时只持久化进度 extras，不额外触发 item patch。
   */
  private async update_translation_progress_if_current(
    handle: TaskRunHandle,
    progress: TaskProgressSnapshot,
  ): Promise<void> {
    if (!this.run_lock.is_current(handle.run_id)) {
      return;
    }
    this.task_data_service.update_translation_progress({
      translation_extras: TaskProgressSnapshotTool.to_record(progress) as unknown as ApiJsonValue,
    });
  }

  /**
   * 分析结束时保存最后一次耗时，候选和 checkpoint 已由批次提交完成。
   */
  private async update_analysis_progress_if_current(
    handle: TaskRunHandle,
    progress: TaskProgressSnapshot,
  ): Promise<void> {
    if (!this.run_lock.is_current(handle.run_id)) {
      return;
    }
    this.task_data_service.update_analysis_progress({
      analysis_extras: TaskProgressSnapshotTool.to_record(progress) as unknown as ApiJsonValue,
    });
  }

  /**
   * 发布 task.status_changed，TaskRuntimeState 会在事件 hub 内同步吸收。
   */
  private emit_status(task_type: TaskType, status: string, busy: boolean): void {
    this.event_hub.publish("task.status_changed", { task_type, status, busy });
  }

  /**
   * 发布 task.progress_changed，只携带真实出现的进度字段和请求中数量。
   */
  private emit_progress(task_type: TaskType, progress: TaskProgressSnapshot): void {
    this.event_hub.publish("task.progress_changed", {
      task_type,
      ...TaskProgressSnapshotTool.to_record(TaskProgressSnapshotTool.with_elapsed(progress)),
      request_in_flight_count: this.request_in_flight_count,
    });
  }

  /**
   * 请求数变化立即广播，保证前端看到的 in-flight 是真实发出请求数。
   */
  private change_request_in_flight_count(task_type: TaskType, delta: number): void {
    this.request_in_flight_count = Math.max(0, this.request_in_flight_count + delta);
    this.event_hub.publish("task.progress_changed", {
      task_type,
      request_in_flight_count: this.request_in_flight_count,
    });
  }

  /**
   * 终态 task patch 复用公开 snapshot builder，避免手写进度字段漏同步。
   */
  private async publish_task_patch(task_type: TaskType): Promise<void> {
    const task = await this.snapshot_builder.build_task_snapshot({ task_type });
    this.event_hub.publish_project_patch({
      source: "task_engine",
      updatedSections: ["task"],
      patch: [{ op: "replace_task", task: task as unknown as ApiJsonValue }],
    });
  }

  /**
   * 读取当前配置和激活模型，作为一次任务 run 的不可变快照。
   */
  private resolve_runtime_snapshot(): TaskRuntimeSnapshot {
    const config_snapshot = this.config_service.load_config();
    const model = resolve_active_model(config_snapshot);
    if (model === null) {
      throw new Error("没有可用的激活模型。");
    }
    return { config_snapshot, model };
  }

  /**
   * 从模型阈值构建限流器；并发缺省固定为 8，RPM 只控制每分钟节奏。
   */
  private build_limiter(model: MutableJsonRecord): TaskLimiter {
    const threshold = this.normalize_record(model["threshold"]);
    return new TaskLimiter({
      concurrency_limit: this.read_number(threshold["concurrency_limit"], 0),
      rpm_limit: this.read_number(threshold["rpm_limit"] ?? threshold["rpm_threshold"], 0),
    });
  }

  /**
   * 输入 token 阈值读取集中处理，保护旧模型配置缺字段场景。
   */
  private get_input_token_limit(model: MutableJsonRecord, fallback: number): number {
    const threshold = this.normalize_record(model["threshold"]);
    return Math.max(16, this.read_number(threshold["input_token_limit"], fallback));
  }

  /**
   * 失败拆分比例沿用 Python `pow(16 / t0, 0.25)` 的收敛速度。
   */
  private get_split_factor(token_threshold: number): number {
    return Math.pow(16 / Math.max(17, token_threshold), 0.25);
  }

  /**
   * 重试超限后强制接受为 ERROR，保证失败条目最终有可提交终态。
   */
  private force_accept_translation_item(item: TaskItemRecord): void {
    if (String(item["dst"] ?? "") === "") {
      item["dst"] = String(item["src"] ?? "");
    }
    item["status"] = "ERROR";
  }

  /**
   * 重翻失败时 TS 本地构造 ERROR item，确保行级 busy 能收尾。
   */
  private ensure_retranslate_terminal_item(
    source_item: TaskItemRecord,
    result: TranslationWorkUnitResult,
  ): TaskItemRecord[] {
    const item = result.items[0] ?? { ...source_item };
    if (this.read_status(item) === "PROCESSED") {
      return [item];
    }
    const failed_item = { ...item };
    this.force_accept_translation_item(failed_item);
    return [failed_item];
  }

  /**
   * 分析 checkpoint payload 在 TS 侧生成，Python 不持有持久状态。
   */
  private build_analysis_checkpoints(
    context: AnalysisContext,
    status: "PROCESSED" | "ERROR",
  ): MutableJsonRecord[] {
    const updated_at = new Date().toISOString();
    return context.items.map((item) => ({
      item_id: item.item_id,
      status,
      updated_at,
      error_count: status === "ERROR" ? 1 : 0,
    }));
  }

  /**
   * 分析上下文转 executor payload，保持 dataclass 字段名稳定。
   */
  private analysis_context_to_payload(context: AnalysisContext): MutableJsonRecord {
    return {
      file_path: context.file_path,
      retry_count: context.retry_count,
      items: context.items as unknown as ApiJsonValue,
    };
  }

  /**
   * 从 item 和 checkpoint map 构建不可变分析输入快照。
   */
  private build_analysis_item_context(
    item: TaskItemRecord,
    checkpoint_status_by_id: Map<number, string>,
  ): AnalysisItemContext | null {
    if (!this.is_analyzable_item(item)) {
      return null;
    }
    const item_id = this.read_item_id(item);
    if (item_id <= 0) {
      return null;
    }
    return {
      item_id,
      file_path: String(item["file_path"] ?? ""),
      src_text: String(item["src"] ?? "").trim(),
      first_name_src: this.read_first_name_src(item),
      previous_status: checkpoint_status_by_id.get(item_id) ?? null,
    };
  }

  /**
   * checkpoint 只接受三态状态，坏数据不会影响调度。
   */
  private build_checkpoint_status_map(checkpoints: MutableJsonRecord[]): Map<number, string> {
    const result = new Map<number, string>();
    for (const checkpoint of checkpoints) {
      const item_id = this.read_number(checkpoint["item_id"], 0);
      const status = String(checkpoint["status"] ?? "");
      if (item_id > 0 && (status === "NONE" || status === "PROCESSED" || status === "ERROR")) {
        result.set(item_id, status);
      }
    }
    return result;
  }

  /**
   * 分析跳过规则和迁移前的稳定语义保持一致。
   */
  private is_analyzable_item(item: TaskItemRecord): boolean {
    return (
      !ANALYSIS_SKIPPED_STATUSES.has(this.read_status(item)) &&
      String(item["src"] ?? "").trim() !== ""
    );
  }

  /**
   * 姓名字段可能是字符串或数组，分析 prompt 只需要第一个说话人名。
   */
  private read_first_name_src(item: TaskItemRecord): string | null {
    const name_src = item["name_src"];
    if (typeof name_src === "string" && name_src !== "") {
      return name_src;
    }
    if (Array.isArray(name_src) && typeof name_src[0] === "string" && name_src[0] !== "") {
      return name_src[0];
    }
    return null;
  }

  /**
   * item id 同时兼容数据库内部 id 和公开 RowBlock 的 item_id。
   */
  private read_item_id(item: TaskItemRecord): number {
    return this.read_number(item["id"] ?? item["item_id"], 0);
  }

  /**
   * item 状态读取集中归一，兼容旧 PROCESSING / PROCESSED_IN_PAST 字符串。
   */
  private read_status(item: TaskItemRecord): string {
    const status = String(item["status"] ?? "NONE");
    if (status === "PROCESSING") {
      return "NONE";
    }
    if (status === "PROCESSED_IN_PAST") {
      return "PROCESSED";
    }
    return status;
  }

  /**
   * 非空行数用于切块 line_limit，和 Python 旧实现保持同一量纲。
   */
  private count_non_empty_lines(text: string): number {
    return text.split(/\r?\n/).filter((line) => line.trim() !== "").length;
  }

  /**
   * TS 暂无 tiktoken 依赖；这里用字符长度估算，只影响切块大小，不改变写入事实。
   */
  private estimate_token_count(text: string): number {
    return Math.max(1, Math.ceil(text.length / 2));
  }

  /**
   * JSON 普通对象数组归一，保护 task-data 返回值边界。
   */
  private normalize_record_list(value: ApiJsonValue | undefined): MutableJsonRecord[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .filter((item): item is JsonRecord => {
        return typeof item === "object" && item !== null && !Array.isArray(item);
      })
      .map((item) => ({ ...item }));
  }

  /**
   * JSON 普通对象归一，避免数组和 null 进入业务分支。
   */
  private normalize_record(value: ApiJsonValue | undefined): MutableJsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value } : {};
  }

  /**
   * 数字字段统一截断，坏值回退到调用方默认值。
   */
  private read_number(value: ApiJsonValue | undefined, fallback: number): number {
    const number_value = Number(value ?? fallback);
    return Number.isFinite(number_value) ? Math.trunc(number_value) : fallback;
  }

  /**
   * 任务启动日志保留旧 Py 侧“API 名称 / 地址 / 模型”三行诊断，方便对照迁移前日志。
   */
  private log_task_run_start(task_label: string, model: MutableJsonRecord): void {
    this.append_log(
      "info",
      `${task_label}启动\nAPI 名称 - ${String(model["name"] ?? "")}\nAPI 地址 - ${String(
        model["api_url"] ?? "",
      )}\n模型 - ${String(model["model_id"] ?? "")}`,
      "ts-task-engine",
    );
  }

  /**
   * 任务终态日志和公开 task.status_changed 分开写，避免只看日志时丢失收尾信息。
   */
  private log_task_run_finish(task_label: string, status: string): void {
    const message =
      status === "DONE"
        ? `${task_label}完成。`
        : status === "IDLE"
          ? `${task_label}已停止。`
          : `${task_label}失败。`;
    this.append_log(status === "ERROR" ? "warning" : "info", message, "ts-task-engine");
  }

  /**
   * worker 返回的日志仍由 main 侧 LogManager 写出，保证文件、控制台和日志窗口三类目标不分叉。
   */
  private emit_work_unit_logs(
    logs?: Array<{ level: "info" | "warning" | "error"; message: string }>,
  ): void {
    if (logs === undefined) {
      return;
    }
    for (const entry of logs) {
      this.append_log(entry.level, entry.message, "ts-task-worker");
    }
  }

  /**
   * 测试桩可能只实现部分日志方法；生产环境仍会走完整 LogManager。
   */
  private append_log(level: "info" | "warning" | "error", message: string, source: string): void {
    const log_manager = this.log_manager as Partial<Pick<LogManager, "info" | "warning" | "error">>;
    log_manager[level]?.(message, { source });
  }

  /**
   * 任务异常统一写入 TS 日志，便于和 work-unit 日志并排排查。
   */
  private log_task_error(message: string, error: unknown): void {
    this.log_manager.error(message, {
      source: "ts-task-engine",
      error_message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}
