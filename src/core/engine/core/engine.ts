import crypto from "node:crypto";

import { resolve_active_model } from "../../model/model-config-resolver";
import type { ApiJsonValue } from "../../api/api-types";
import { TaskRuntimePublisher } from "../runtime/task-runtime-publisher";
import type { JsonRecord, MutableJsonRecord, TaskType } from "../runtime/task-runtime-types";
import { ProjectTaskStore } from "../store/project-task-store";
import { TaskArtifactCommitter } from "../store/task-artifact-committer";
import type { WorkUnitExecutor } from "../work-unit/work-unit-executor";
import { WorkUnitExecutorTransportError } from "../work-unit/work-unit-transport-error";
import type { StartTaskCommand, StopTaskCommand } from "../protocol/task-command";
import type { TaskStartMode } from "../../../domain/task";
import type { WorkUnitExecutionResult } from "../protocol/work-unit-result";
import { PromptBuilder } from "../work-unit/work-unit-prompt-builder";
import type {
  AnalysisWorkUnitResult,
  TaskProgressSnapshot,
  TaskRunHandle,
  TranslationWorkUnitResult,
  TaskEngineOptions,
} from "./engine-options";
import type {
  AnalysisCommitEntry,
  AnalysisContext,
  TaskItemRecord,
  TranslationCommitEntry,
  TranslationContext,
} from "../planning/task-plan-types";
import { LimiterPool, TaskLimiter } from "./limiter-pool";
import { ModelKeyLeasePool } from "./model-key-lease-pool";
import { TaskPipeline } from "./pipeline-runner";
import { TaskProgressSnapshotTool } from "./progress-accumulator";
import { RunCoordinator } from "./run-coordinator";
import { TaskLogReplay } from "./log-replay";
import { is_task_skipped_item_status } from "../../../domain/task";
import { TextQualitySnapshotTool } from "../../../shared/text/text-types";
import * as AppErrors from "../../../shared/error";

const TRANSLATION_TERMINAL_STATUSES = new Set(["PROCESSED", "ERROR"]); // 翻译终态只认已处理和错误，跳过类状态不参与重试终结判断

const TRANSLATION_RETRY_LIMIT = 3; // 翻译重试次数高于分析，因为翻译支持拆分重试，分析只按 chunk 重试
const ANALYSIS_RETRY_LIMIT = 2; // 分析失败只重发同一 chunk，过多重试会阻塞后续文件 checkpoint

const DEFAULT_INPUT_TOKEN_LIMIT = 512; // 模型未配置 token 限制时使用保守默认值，避免一次塞入过长 prompt
// 一次任务启动时冻结配置和模型，运行中不跟随设置页热变更
interface TaskRuntimeSnapshot {
  config_snapshot: MutableJsonRecord;
  model: MutableJsonRecord;
}

/**
 * Electron main 的后台任务执行权威，持有生命周期、调度、限流、停止、重试和提交循环
 */
export class TaskEngine {
  private readonly app_root: string; // app_root 让 Core 启动日志和 worker 使用同一套提示词资源
  private readonly task_store: ProjectTaskStore; // task_store 是后台任务唯一项目数据写入口，TaskEngine 不直接碰 database
  private readonly artifact_committer: TaskArtifactCommitter; // artifact_committer 是 Engine 写入项目任务事实的唯一出口
  private readonly task_runtime_publisher: TaskRuntimePublisher; // task_runtime_publisher 同步写运行态并发布完整 snapshot
  private readonly executor_client: WorkUnitExecutor; // executor_client 屏蔽 worker_threads / in_process runner 差异，主流程只关心 work-unit 结果
  private readonly task_planner: TaskEngineOptions["taskPlanner"]; // task_planner 是切块与 token cache 复用的唯一规划入口
  private readonly app_setting_service: TaskEngineOptions["AppSettingService"];
  private readonly run_coordinator: RunCoordinator; // run_coordinator 是整场任务互斥、停止和终态发布的唯一权威
  private readonly log_replay: TaskLogReplay; // log_replay 统一处理任务生命周期日志和 worker 日志回放
  private readonly limiter_pool = new LimiterPool(); // limiter_pool 让后台任务和单条翻译共用同一模型节奏入口
  private readonly model_key_lease_pool = new ModelKeyLeasePool(); // model_key_lease_pool 在主线程维护任务级全局 Key 轮换
  private request_in_flight_count = 0; // request_in_flight_count 只表达实时网络压力，不落库也不参与恢复

  /**
   * 注入任务执行依赖，保证任务数据写入口和 work-unit executor 边界可测试
   */
  public constructor(options: TaskEngineOptions) {
    this.app_root = options.appRoot;
    this.task_store = options.taskStore;
    this.artifact_committer = new TaskArtifactCommitter(options.taskStore);
    this.task_runtime_publisher = options.taskRuntimePublisher;
    this.executor_client = options.executorClient;
    this.task_planner = options.taskPlanner;
    this.app_setting_service = options.AppSettingService;
    this.run_coordinator = new RunCoordinator(options.taskRuntimePublisher);
    this.log_replay = new TaskLogReplay(options.logManager);
  }

  /**
   * 启动后台任务；Engine 只按 TaskType 获取运行锁，业务差异留在任务命令和后续计划内解释
   */
  public async start(command: StartTaskCommand): Promise<void> {
    const handle = this.run_coordinator.begin(command.task_type);
    if (command.task_type === "translation") {
      void this.run_translation(handle, command);
      return;
    }
    void this.run_analysis(handle, command.mode);
  }

  /**
   * 请求停止后台任务；返回值表示命令是否命中当前 run
   */
  public async stop(command: StopTaskCommand): Promise<boolean> {
    return await this.run_coordinator.request_stop(command.task_type);
  }

  /**
   * 单条翻译不占后台全局锁，但仍必须获取模型请求资格后再调用 executor
   */
  public async translate_single(text: string): Promise<MutableJsonRecord> {
    const runtime = this.resolve_runtime_snapshot();
    const limiter = this.resolve_task_limiter(runtime.model);
    const controller = new AbortController();
    const lease = await limiter.acquire(controller.signal);
    const run_id = crypto.randomUUID();
    try {
      const leased_model = this.model_key_lease_pool.lease_model(runtime.model);
      const response = await this.executor_client.translate_single(
        {
          run_id,
          work_unit_id: "single",
          task_type: "translate-single",
          model: leased_model as unknown as ApiJsonValue,
          config_snapshot: runtime.config_snapshot as unknown as ApiJsonValue,
          quality_snapshot: null,
          text,
        },
        controller.signal,
      );
      this.log_replay.work_unit_logs(response.logs);
      const { logs: _logs, ...public_response } = response;
      return public_response;
    } finally {
      lease.release();
    }
  }

  /**
   * 翻译主流程：普通翻译与重翻共享任务类型，差异只由 scope 与 artifact 提交语义表达
   */
  private async run_translation(
    handle: TaskRunHandle,
    command: Extract<StartTaskCommand, { task_type: "translation" }>,
  ): Promise<void> {
    let final_status: "done" | "idle" | "error" = "done";
    let app_language: unknown = "ZH";
    let release_database_lease: (() => void) | null = null; // release_database_lease 只负责释放本轮任务连接租约，不承载任务状态
    const legacy_mode = this.to_legacy_mode(command.mode);
    const translation_scope = command.scope;
    const retranslate = translation_scope.kind === "items";
    try {
      await this.emit_status(handle.task_type, "running", true);
      release_database_lease = this.task_store.acquire_project_lease(
        `task:${handle.run_id}:translation`,
      );
      const runtime = this.resolve_runtime_snapshot();
      app_language = runtime.config_snapshot["app_language"];
      const quality_snapshot = this.task_store.build_quality_snapshot();
      await this.log_task_run_start("translation", runtime, quality_snapshot, app_language);
      const payload =
        translation_scope.kind === "items"
          ? this.task_store.get_translation_items_by_scope({
              item_ids: translation_scope.item_ids as unknown as ApiJsonValue,
            })
          : this.task_store.get_translation_items({ mode: legacy_mode });
      const all_items = this.normalize_record_list(payload["items"]);
      const meta = this.normalize_record(payload["meta"]);
      const contexts = retranslate
        ? all_items.map((item) => this.build_retranslate_context(item))
        : await this.task_planner.build_translation_contexts(
            all_items,
            runtime.config_snapshot,
            runtime.model,
            handle.signal,
          );
      let progress = retranslate
        ? this.build_retranslate_progress(all_items, meta)
        : this.build_translation_progress(legacy_mode, all_items, meta);
      await this.update_translation_progress_if_current(handle, progress);
      await this.emit_progress(handle.task_type);
      const limiter = this.resolve_task_limiter(runtime.model);
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
          progress = retranslate
            ? await this.commit_retranslate_entries(handle, entries, progress)
            : await this.commit_translation_entries(handle, entries, progress);
        },
      });
      await pipeline.run(contexts);
      if (handle.signal.aborted) {
        final_status = "idle";
      }
      progress = TaskProgressSnapshotTool.with_elapsed(progress);
      await this.update_translation_progress_if_current(handle, progress);
    } catch (error) {
      final_status = handle.signal.aborted ? "idle" : "error";
      if (!handle.signal.aborted) {
        this.log_replay.task_error(
          retranslate ? "重翻任务执行失败。" : "翻译任务执行失败。",
          error,
        );
      }
    } finally {
      this.log_replay.task_run_finish(final_status, app_language);
      await this.finish_run(handle, final_status);
      release_database_lease?.();
    }
  }

  /**
   * 分析主流程：Task Engine 解释 checkpoint，work unit 只负责单个 chunk 请求
   */
  private async run_analysis(handle: TaskRunHandle, mode: string): Promise<void> {
    let final_status: "done" | "idle" | "error" = "done";
    let app_language: unknown = "ZH";
    let release_database_lease: (() => void) | null = null; // release_database_lease 只负责释放本轮任务连接租约，不承载任务状态
    const legacy_mode = this.to_legacy_mode(mode);
    try {
      await this.emit_status(handle.task_type, "running", true);
      release_database_lease = this.task_store.acquire_project_lease(
        `task:${handle.run_id}:analysis`,
      );
      const runtime = this.resolve_runtime_snapshot();
      app_language = runtime.config_snapshot["app_language"];
      const quality_snapshot = this.task_store.build_quality_snapshot();
      await this.log_task_run_start("analysis", runtime, quality_snapshot, app_language);
      if (legacy_mode === "NEW" || legacy_mode === "RESET") {
        this.task_store.reset_analysis_progress({});
      }
      const payload = this.task_store.get_analysis_context({});
      const all_items = this.normalize_record_list(payload["items"]);
      const checkpoints = this.normalize_record_list(payload["checkpoints"]);
      const meta = this.normalize_record(payload["meta"]);
      const contexts = await this.task_planner.build_analysis_contexts(
        all_items,
        checkpoints,
        runtime.model,
        handle.signal,
      );
      let progress = this.build_analysis_progress(legacy_mode, all_items, checkpoints, meta);
      await this.update_analysis_progress_if_current(handle, progress);
      await this.emit_progress(handle.task_type);
      const limiter = this.resolve_task_limiter(runtime.model);
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
        final_status = "idle";
      }
      progress = TaskProgressSnapshotTool.with_elapsed(progress);
      await this.update_analysis_progress_if_current(handle, progress);
    } catch (error) {
      final_status = handle.signal.aborted ? "idle" : "error";
      if (!handle.signal.aborted) {
        this.log_replay.task_error("分析任务执行失败。", error);
      }
    } finally {
      this.log_replay.task_run_finish(final_status, app_language);
      await this.finish_run(handle, final_status);
      release_database_lease?.();
    }
  }

  /**
   * 执行翻译 chunk，并把失败条目转换成高优重试上下文
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
        this.executor_client
          .execute_unit(
            {
              run_id: handle.run_id,
              unit_id: context.work_unit_id,
              kind: "translation",
              model: this.model_key_lease_pool.lease_model(
                runtime.model,
              ) as unknown as ApiJsonValue,
              config_snapshot: runtime.config_snapshot as unknown as ApiJsonValue,
              quality_snapshot,
              payload: {
                items: context.items as unknown as ApiJsonValue,
                precedings: context.precedings as unknown as ApiJsonValue,
              },
              diagnostics: {
                split_count: context.split_count,
                retry_count: context.retry_count,
                token_threshold: context.token_threshold,
                is_initial: context.is_initial,
              },
            },
            signal,
          )
          .then((unit_result) => this.to_translation_work_unit_result(unit_result)),
    );
    this.log_replay.work_unit_logs(result.logs);
    return await this.build_translation_worker_result(context, result, signal);
  }

  /**
   * 执行分析 chunk，失败会按固定次数重试，最终失败才写 ERROR checkpoint
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
      this.executor_client
        .execute_unit(
          {
            run_id: handle.run_id,
            unit_id: context.work_unit_id,
            kind: "analysis",
            model: this.model_key_lease_pool.lease_model(runtime.model) as unknown as ApiJsonValue,
            config_snapshot: runtime.config_snapshot as unknown as ApiJsonValue,
            quality_snapshot,
            payload: {
              file_path: context.file_path,
              items: context.items as unknown as ApiJsonValue,
            },
            diagnostics: {
              retry_count: context.retry_count,
            },
          },
          signal,
        )
        .then((unit_result) => this.to_analysis_work_unit_result(unit_result)),
    );
    this.log_replay.work_unit_logs(result.logs);
    return this.build_analysis_worker_result(context, result);
  }

  /**
   * executor 网络抖动只让当前 chunk 进入翻译重试计划，不能中止整场任务和丢弃其它完成结果
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
   * 带限流执行 work unit 请求，同时维护 服务端真实 request_in_flight_count
   */
  private async call_with_limiter<T>(
    handle: TaskRunHandle,
    limiter: TaskLimiter,
    signal: AbortSignal,
    callback: () => Promise<T>,
  ): Promise<T> {
    const lease = await limiter.acquire(signal);
    await this.change_request_in_flight_count(handle.task_type, 1);
    try {
      return await callback();
    } finally {
      await this.change_request_in_flight_count(handle.task_type, -1);
      lease.release();
    }
  }

  /**
   * WorkUnitExecutionResult 转回当前翻译解释器输入，过渡期只在 Engine 边界做一次形状窄化
   */
  private to_translation_work_unit_result(
    result: WorkUnitExecutionResult,
  ): TranslationWorkUnitResult {
    if (result.kind !== "translation" || result.output.kind !== "translation") {
      throw new AppErrors.WorkerExecutionFailedError({
        diagnostic_context: {
          expected_kind: "translation",
          result_kind: result.kind,
          output_kind: result.output.kind,
        },
      });
    }
    return {
      items: this.normalize_record_list(result.output.items),
      row_count: result.output.row_count,
      input_tokens: result.metrics.input_tokens,
      output_tokens: result.metrics.output_tokens,
      stopped: result.outcome === "stopped",
      logs: result.logs,
    };
  }

  /**
   * WorkUnitExecutionResult 转回当前分析解释器输入，checkpoint 与 progress 仍由 Engine 侧生成
   */
  private to_analysis_work_unit_result(result: WorkUnitExecutionResult): AnalysisWorkUnitResult {
    if (result.kind !== "analysis" || result.output.kind !== "analysis") {
      throw new AppErrors.WorkerExecutionFailedError({
        diagnostic_context: {
          expected_kind: "analysis",
          result_kind: result.kind,
          output_kind: result.output.kind,
        },
      });
    }
    return {
      success: result.outcome === "success",
      stopped: result.outcome === "stopped",
      input_tokens: result.metrics.input_tokens,
      output_tokens: result.metrics.output_tokens,
      glossary_entries: this.normalize_record_list(result.output.glossary_entries),
      logs: result.logs,
    };
  }

  /**
   * 翻译 worker 结果拆成可提交终态 items 与需要重试的上下文
   */
  private async build_translation_worker_result(
    context: TranslationContext,
    result: TranslationWorkUnitResult,
    signal: AbortSignal,
  ) {
    if (result.stopped) {
      return { commit_entries: [], retry_contexts: [] };
    }
    const returned_items = result.items.length > 0 ? result.items : context.items;
    const terminal_items = returned_items.filter((item) =>
      TRANSLATION_TERMINAL_STATUSES.has(this.read_status(item)),
    );
    const retry_plan = await this.task_planner.build_translation_retry_plan(
      context,
      returned_items,
      TRANSLATION_RETRY_LIMIT,
      (item) => this.mark_translation_item_error(item),
      signal,
    );
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
   * 分析 worker 结果转换为 checkpoint、候选和 token 提交载荷
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
   * 提交翻译批次并推进持久进度；迟到 run 不允许写入
   */
  private async commit_translation_entries(
    handle: TaskRunHandle,
    entries: TranslationCommitEntry[],
    progress: TaskProgressSnapshot,
  ): Promise<TaskProgressSnapshot> {
    if (!this.run_coordinator.is_current(handle.run_id) || entries.length === 0) {
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
    this.artifact_committer.commit(
      "translation",
      [
        {
          kind: "item_updates",
          source: "translation",
          items: items as unknown as ApiJsonValue,
          affects_proofreading: false,
        },
      ],
      TaskProgressSnapshotTool.to_record(next_progress),
    );
    await this.emit_progress(handle.task_type);
    return next_progress;
  }

  /**
   * 提交分析批次，候选聚合和 checkpoint 写入仍走 ProjectTaskStore
   */
  private async commit_analysis_entries(
    handle: TaskRunHandle,
    entries: AnalysisCommitEntry[],
    progress: TaskProgressSnapshot,
  ): Promise<TaskProgressSnapshot> {
    if (!this.run_coordinator.is_current(handle.run_id) || entries.length === 0) {
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
    this.artifact_committer.commit(
      "analysis",
      [
        {
          kind: "analysis_checkpoints",
          checkpoints: entries.flatMap((entry) => [
            ...entry.success_checkpoints,
            ...entry.error_checkpoints,
          ]) as unknown as ApiJsonValue,
        },
        {
          kind: "analysis_candidates",
          entries: entries.flatMap((entry) => entry.glossary_entries) as unknown as ApiJsonValue,
        },
      ],
      TaskProgressSnapshotTool.to_record(next_progress),
    );
    await this.emit_progress(handle.task_type);
    return next_progress;
  }

  /**
   * 提交重翻结果，ProjectTaskStore 会同步推进 items/proofreading，并回传行级 busy 快照
   */
  private async commit_retranslate_entries(
    handle: TaskRunHandle,
    entries: TranslationCommitEntry[],
    progress: TaskProgressSnapshot,
  ): Promise<TaskProgressSnapshot> {
    if (!this.run_coordinator.is_current(handle.run_id) || entries.length === 0) {
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
    this.artifact_committer.commit(
      "translation",
      [
        {
          kind: "item_updates",
          source: "translation",
          items: items as unknown as ApiJsonValue,
          affects_proofreading: true,
        },
      ],
      TaskProgressSnapshotTool.to_record(next_progress),
    );
    await this.emit_progress(handle.task_type);
    return next_progress;
  }

  /**
   * 重翻每个 item 独立执行，保持行级 busy 状态能逐条收敛
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
   * 根据任务模式和当前 item 状态创建翻译进度初始值
   */
  private build_translation_progress(
    mode: string,
    items: TaskItemRecord[],
    meta: MutableJsonRecord,
  ): TaskProgressSnapshot {
    const total_line = items.filter(
      (item) => !is_task_skipped_item_status(this.read_status(item)),
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
   * 根据 checkpoint 和 meta 创建分析进度初始值
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
   * 重翻进度复用 translation_extras 的 token 累计，但本轮行数只看选中条目
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
   * 运行结束后只发布任务终态；项目数据变更由 ProjectTaskStore 的项目事件承担
   */
  private async finish_run(
    handle: TaskRunHandle,
    status: "idle" | "done" | "error",
  ): Promise<void> {
    this.request_in_flight_count = 0;
    await this.run_coordinator.finish(handle, status);
  }

  /**
   * 翻译结束时只持久化进度 extras，不额外触发 item patch
   */
  private async update_translation_progress_if_current(
    handle: TaskRunHandle,
    progress: TaskProgressSnapshot,
  ): Promise<void> {
    if (!this.run_coordinator.is_current(handle.run_id)) {
      return;
    }
    this.task_store.update_translation_progress({
      translation_extras: TaskProgressSnapshotTool.to_record(progress) as unknown as ApiJsonValue,
    });
  }

  /**
   * 分析结束时保存最后一次耗时，候选和 checkpoint 已由批次提交完成
   */
  private async update_analysis_progress_if_current(
    handle: TaskRunHandle,
    progress: TaskProgressSnapshot,
  ): Promise<void> {
    if (!this.run_coordinator.is_current(handle.run_id)) {
      return;
    }
    this.task_store.update_analysis_progress({
      analysis_extras: TaskProgressSnapshotTool.to_record(progress) as unknown as ApiJsonValue,
    });
  }

  /**
   * 发布完整 task.snapshot_changed，生命周期状态先写入运行态
   */
  private async emit_status(
    task_type: TaskType,
    status: "idle" | "requested" | "running" | "stopping" | "done" | "error",
    busy: boolean,
  ): Promise<void> {
    await this.task_runtime_publisher.publish_status(task_type, status, busy);
  }

  /**
   * 任务进度已提交后发布完整 snapshot；进度字段由 `.lg` meta 读取
   */
  private emit_progress(task_type: TaskType): Promise<void> {
    return this.task_runtime_publisher.publish_progress_committed(task_type);
  }

  /**
   * 请求数变化只更新运行态，公开 snapshot 由后端 500ms 窗口合并发布
   */
  private async change_request_in_flight_count(task_type: TaskType, delta: number): Promise<void> {
    this.request_in_flight_count = Math.max(0, this.request_in_flight_count + delta);
    this.task_runtime_publisher.publish_request_pressure(task_type, this.request_in_flight_count);
  }

  /**
   * 读取当前配置和激活模型，作为一次任务 run 的不可变快照
   */
  private resolve_runtime_snapshot(): TaskRuntimeSnapshot {
    const config_snapshot = this.app_setting_service.read_setting();
    const model = resolve_active_model(config_snapshot);
    if (model === null) {
      throw new AppErrors.ModelNotFoundError();
    }
    return { config_snapshot, model };
  }

  /**
   * 对齐旧实现：非 SakuraLLM 任务启动时在 API 信息后打印本轮主提示词
   */
  private async log_task_run_start(
    task_type: TaskType,
    runtime: TaskRuntimeSnapshot,
    quality_snapshot: ApiJsonValue,
    app_language: unknown,
  ): Promise<void> {
    const prompt_text = await this.build_task_start_prompt(task_type, runtime, quality_snapshot);
    this.log_replay.task_run_start(runtime.model, app_language, prompt_text);
  }

  /**
   * 启动提示词只用于诊断日志，实际请求仍由 worker 基于同一快照重新构造完整 messages
   */
  private async build_task_start_prompt(
    task_type: TaskType,
    runtime: TaskRuntimeSnapshot,
    quality_snapshot: ApiJsonValue,
  ): Promise<string | null> {
    if (String(runtime.model["api_format"] ?? "") === "SakuraLLM") {
      return null;
    }
    const builder = new PromptBuilder(
      this.app_root,
      {
        app_language: this.read_optional_string(runtime.config_snapshot["app_language"]),
        source_language: this.read_optional_string(runtime.config_snapshot["source_language"]),
        target_language: this.read_optional_string(runtime.config_snapshot["target_language"]),
      },
      TextQualitySnapshotTool.from_api_value(quality_snapshot),
    );
    return task_type === "analysis"
      ? await builder.build_glossary_analysis_main()
      : await builder.build_main();
  }

  /**
   * ProjectTaskStore 仍使用历史大写 mode 字段读写 `.lg` 事实，Engine 边界只接受小写命令
   */
  private to_legacy_mode(mode: TaskStartMode | string): string {
    switch (mode) {
      case "continue":
        return "CONTINUE";
      case "reset":
        return "RESET";
      default:
        return "NEW";
    }
  }

  /**
   * 解析任务限流器；同一模型配置下后台任务与单条翻译共享并发和 RPM 节奏
   */
  private resolve_task_limiter(model: MutableJsonRecord): TaskLimiter {
    return this.limiter_pool.resolve(model);
  }

  /**
   * 重试超限后只标记 ERROR，译文字段继续只承载真实译文
   */
  private mark_translation_item_error(item: TaskItemRecord): void {
    item["status"] = "ERROR";
  }

  /**
   * 分析 checkpoint payload 在 服务端生成，worker 不持有持久状态
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
   * checkpoint 只接受三态状态，坏数据不会影响调度
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
   * 分析跳过规则保持稳定语义
   */
  private is_analyzable_item(item: TaskItemRecord): boolean {
    return (
      !is_task_skipped_item_status(this.read_status(item)) &&
      String(item["src"] ?? "").trim() !== ""
    );
  }

  /**
   * item id 同时兼容数据库内部 id 和公开 item_id
   */
  private read_item_id(item: TaskItemRecord): number {
    return this.read_number(item["id"] ?? item["item_id"], 0);
  }

  /**
   * 读取 item 当前状态事实
   */
  private read_status(item: TaskItemRecord): string {
    return String(item["status"] ?? "NONE");
  }

  /**
   * JSON 普通对象数组归一，保护 task-data 返回值边界
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
   * JSON 普通对象归一，避免数组和 null 进入业务分支
   */
  private normalize_record(value: ApiJsonValue | undefined): MutableJsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value } : {};
  }

  /**
   * 数字字段统一截断，坏值回退到调用方默认值
   */
  private read_number(value: ApiJsonValue | undefined, fallback: number): number {
    const number_value = Number(value ?? fallback);
    return Number.isFinite(number_value) ? Math.trunc(number_value) : fallback;
  }

  /**
   * 提示词构造只接受字符串配置，缺失值交给 PromptBuilder 默认口径处理
   */
  private read_optional_string(value: ApiJsonValue | undefined): string | undefined {
    return typeof value === "string" ? value : undefined;
  }
}
