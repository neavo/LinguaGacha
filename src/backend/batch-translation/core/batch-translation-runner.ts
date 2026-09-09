import { resolve_model_capability } from "../../llm/model-capability";
import type { TextQualitySnapshot } from "../../../shared/text/text-types";
import type { TextTaskItemRecord } from "../../../shared/text/text-types";
import { AppError } from "../../../shared/error";
import { prepare_translation_targets } from "../planning/translation-targets";

import type { BatchTranslationRunHandle } from "../batch-translation-runtime";
import type { WorkUnitExecutor } from "../work-unit/work-unit-executor";
import { WorkUnitExecutorTransportError } from "../work-unit/work-unit-transport-error";
import type {
  BatchTranslationStartCommand,
  BatchTranslationResult,
} from "../../../domain/batch-translation";
import type { WorkUnitExecutionResult } from "../protocol/work-unit-result";
import { PromptBuilder } from "../work-unit/work-unit-prompt-builder";
import type { BatchTranslationProgress } from "../../../domain/batch-translation";
import type {
  TranslationWorkUnitResult,
  BatchTranslationRunnerOptions,
  BatchTranslationRunContext,
} from "./batch-translation-runner-options";
import type {
  TranslationCommitEntry,
  TranslationContext,
} from "../planning/translation-plan-types";
import { LimiterPool, TranslationLimiter } from "./limiter-pool";
import { ModelKeyLeasePool } from "./model-key-lease-pool";
import { TranslationPipeline } from "./translation-pipeline";
import { TranslationProgressAccumulator } from "./progress-accumulator";
import { TranslationLogReplay } from "./log-replay";
import { is_task_skipped_item_status } from "../../../domain/batch-translation";
import { type MutableJsonRecord } from "../../../domain/json";

import { normalize_setting_snapshot } from "../../../domain/setting";
import { read_task_item_status, read_task_item_id } from "../translation-item";

const TRANSLATION_TERMINAL_STATUSES = new Set(["PROCESSED", "ERROR"]); // 翻译终态只认已处理和错误，跳过类状态不参与重试终结判断

const TRANSLATION_RETRY_LIMIT = 3; // 单条翻译在拆分后最多重试三次。

/**
 * Backend Runtime 与 CLI 共用的翻译调度、限流、重试和提交循环
 */
export class BatchTranslationRunner {
  private readonly builtin_root: string; // 让 Backend 启动日志和 worker 使用同一套内置提示词
  private readonly task_store: BatchTranslationRunnerOptions["taskStore"]; // 后台任务唯一项目数据写入口，BatchTranslationRunner 不直接碰 database
  private readonly task_runtime: BatchTranslationRunnerOptions["taskRuntime"]; // 任务锁、取消、快照与请求压力的最小运行态能力
  private readonly executor_client: WorkUnitExecutor; // 屏蔽 worker_threads / in_process runner 差异，主流程只关心 work-unit 结果
  private readonly task_planner: BatchTranslationRunnerOptions["taskPlanner"]; // 切块与 token cache 复用的唯一规划入口
  private readonly log_replay: TranslationLogReplay; // 统一处理任务生命周期日志和 worker 日志回放
  private readonly limiter_pool = new LimiterPool(); // 后台任务按模型资源键复用请求节奏入口
  private readonly model_key_lease_pool = new ModelKeyLeasePool(); // 在主线程维护任务级全局 Key 轮换
  /**
   * 注入任务执行依赖，保证任务数据写入口和 work-unit executor 边界可测试
   */
  public constructor(options: BatchTranslationRunnerOptions) {
    this.builtin_root = options.builtinRoot;
    this.task_store = options.taskStore;
    this.task_runtime = options.taskRuntime;
    this.executor_client = options.executorClient;
    this.task_planner = options.taskPlanner;
    this.log_replay = new TranslationLogReplay(options.logManager);
  }

  /**
   * 翻译主流程：普通翻译与重翻共享执行链，目的决定目标资格与提交副作用，范围限制实际写入集合
   */
  public async run(
    handle: BatchTranslationRunHandle,
    command: BatchTranslationStartCommand,
    run_context: BatchTranslationRunContext,
  ): Promise<BatchTranslationResult> {
    let final_status: "done" | "stopped" | "error" = "done";
    let app_language: unknown = "ZH";
    let progress = this.task_runtime.read_progress(); // 工程累计事实，由项目写入口维护。
    let run_progress = TranslationProgressAccumulator.empty(); // 本轮计数随已提交结果推进。
    const infrastructure_errors: unknown[] = [];
    let release_database_lease: (() => void) | null = null; // 只负责释放本轮任务连接租约，不承载任务状态
    const retranslate = command.operation === "retranslate";
    const mode = command.operation === "translate" ? command.mode : "continue";
    try {
      await this.task_runtime.publish_status(handle, "running");
      release_database_lease = this.task_store.acquire_project_lease(
        `task:${handle.run_id}:translation`,
      );
      await this.task_runtime.publish_config(handle, {
        model_name: run_context.model.name,
        model_id: run_context.model.model_id,
        thinking_level:
          resolve_model_capability(run_context.model).available_thinking_levels.length === 0
            ? null
            : run_context.model.thinking.level,
        source_language: String(run_context.config_snapshot["source_language"]),
        target_language: String(run_context.config_snapshot["target_language"]),
      });
      app_language = run_context.config_snapshot["app_language"];
      const quality_snapshot = this.task_store.build_quality_snapshot();
      this.log_task_run_start(run_context, quality_snapshot, app_language);
      const items = this.task_store.get_translation_items();
      const prepared = prepare_translation_targets(items, command);
      progress = this.build_translation_progress(mode, items, progress);
      run_progress = TranslationProgressAccumulator.empty(prepared.target_ids.size);
      await this.update_translation_progress_if_current(handle, progress);
      await this.task_runtime.publish_progress(handle, [], run_progress);
      const contexts = await this.task_planner.build_translation_contexts(
        prepared.items,
        run_context.config_snapshot,
        run_context.model,
        handle.signal,
        prepared.target_ids,
      );
      const limiter = this.resolve_task_limiter(run_context.model);
      const pipeline = new TranslationPipeline({
        worker_count: limiter.max_concurrency,
        signal: handle.signal,
        execute: (context, signal) =>
          this.execute_translation_context(
            handle,
            context,
            run_context,
            quality_snapshot,
            limiter,
            signal,
          ),
        commit: async (entries) => {
          run_progress = await this.commit_translation_entries(
            handle,
            entries,
            run_progress,
            retranslate,
          );
        },
      });
      await pipeline.run(contexts);
      if (handle.signal.aborted) {
        final_status = "stopped";
      }
    } catch (error) {
      final_status = handle.signal.aborted ? "stopped" : "error";
      if (!handle.signal.aborted) {
        try {
          this.log_replay.task_error(
            retranslate ? "重翻任务执行失败。" : "翻译任务执行失败。",
            error,
          );
        } catch (log_error) {
          infrastructure_errors.push(error, log_error);
        }
      }
    } finally {
      try {
        // 提交后事件失败也可能已写入数据库，最终统计读取真实已提交事实。
        progress = TranslationProgressAccumulator.with_elapsed(this.task_runtime.read_progress());
        await this.update_translation_progress_if_current(handle, progress);
        run_progress = TranslationProgressAccumulator.with_elapsed(
          this.task_runtime.read_run_progress() ?? run_progress,
        );
        await this.task_runtime.publish_progress(handle, [], run_progress);
      } catch (error) {
        infrastructure_errors.push(error);
      }
      try {
        release_database_lease?.();
      } catch (error) {
        final_status = "error";
        infrastructure_errors.push(error);
      }
      try {
        this.log_replay.task_run_finish(final_status, app_language);
      } catch (error) {
        infrastructure_errors.push(error);
      }
    }
    if (infrastructure_errors.length > 0)
      throw infrastructure_errors.length === 1
        ? infrastructure_errors[0]
        : new AggregateError(infrastructure_errors, "Batch translation cleanup failed.");
    return { status: final_status, progress: { ...progress }, run_progress: { ...run_progress } };
  }

  /**
   * 执行翻译 chunk，并把失败条目转换成高优重试上下文
   */
  private async execute_translation_context(
    handle: BatchTranslationRunHandle,
    context: TranslationContext,
    run_context: BatchTranslationRunContext,
    quality_snapshot: TextQualitySnapshot,
    limiter: TranslationLimiter,
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
              model: this.model_key_lease_pool.lease_model(run_context.model),
              config_snapshot: run_context.config_snapshot,
              quality_snapshot,
              payload: {
                items: context.items,
                precedings: context.precedings,
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
   * executor 网络抖动只让当前 chunk 进入翻译重试计划，不能中止整场任务和丢弃其它完成结果
   */
  private async call_translation_executor_with_retryable_transport(
    context: TranslationContext,
    handle: BatchTranslationRunHandle,
    signal: AbortSignal,
    limiter: TranslationLimiter,
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
        input_tokens: 0,
        reasoning_tokens: 0,
        output_tokens: 0,
        stopped: false,
      };
    }
  }

  /**
   * 带限流执行 work unit 请求，同时维护 服务端真实 request_in_flight_count
   */
  private async call_with_limiter<T>(
    handle: BatchTranslationRunHandle,
    limiter: TranslationLimiter,
    signal: AbortSignal,
    callback: () => Promise<T>,
  ): Promise<T> {
    const lease = await limiter.acquire(signal);
    this.task_runtime.change_request_in_flight_count(handle, 1);
    try {
      return await callback();
    } finally {
      this.task_runtime.change_request_in_flight_count(handle, -1);
      lease.release();
    }
  }

  /** 将 worker 信封投影为重试与提交所需的执行结果。 */
  private to_translation_work_unit_result(
    result: WorkUnitExecutionResult,
  ): TranslationWorkUnitResult {
    return {
      items: result.output.items,
      input_tokens: result.metrics.input_tokens,
      reasoning_tokens: result.metrics.reasoning_tokens,
      output_tokens: result.metrics.output_tokens,
      stopped: result.outcome === "stopped",
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
      TRANSLATION_TERMINAL_STATUSES.has(read_task_item_status(item)),
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
                reasoning_tokens: result.reasoning_tokens,
                output_tokens: result.output_tokens,
              },
            ]
          : [],
      retry_contexts: retry_plan.retry_contexts,
    };
  }

  /**
   * 提交翻译批次并推进持久进度；迟到 run 不允许写入
   */
  private async commit_translation_entries(
    handle: BatchTranslationRunHandle,
    entries: TranslationCommitEntry[],
    run_progress: BatchTranslationProgress,
    affects_proofreading: boolean,
  ): Promise<BatchTranslationProgress> {
    if (!this.task_runtime.is_current(handle.run_id) || entries.length === 0) {
      return run_progress;
    }
    const items = entries.flatMap((entry) => entry.items);
    const processed_delta = items.filter(
      (item) => read_task_item_status(item) === "PROCESSED",
    ).length;
    const error_delta = items.filter((item) => read_task_item_status(item) === "ERROR").length;
    let next_progress = this.task_runtime.read_progress(); // 每次提交从权威累计事实继续。
    let next_run = TranslationProgressAccumulator.with_counts(run_progress, {
      processed_line: run_progress.processed_line + processed_delta,
      error_line: run_progress.error_line + error_delta,
    });
    for (const entry of entries) {
      next_run = TranslationProgressAccumulator.add_tokens(
        next_run,
        entry.input_tokens,
        entry.reasoning_tokens,
        entry.output_tokens,
      );
      next_progress = TranslationProgressAccumulator.add_tokens(
        next_progress,
        entry.input_tokens,
        entry.reasoning_tokens,
        entry.output_tokens,
      );
    }
    next_progress = TranslationProgressAccumulator.with_elapsed(next_progress);
    next_run = TranslationProgressAccumulator.with_elapsed(next_run);
    try {
      await this.task_store.commit_translation_items(items, next_progress, affects_proofreading);
    } catch (error) {
      // 事务已经提交但事件同步失败时，本轮结果仍然成立；保留原始诊断。
      if (error instanceof AppError && error.code === "data.committed_sync_failed") {
        try {
          await this.task_runtime.publish_progress(handle, items.map(read_task_item_id), next_run);
        } catch (publish_error) {
          throw new AggregateError(
            [error, publish_error],
            "Committed translation publication failed.",
          );
        }
      }
      throw error;
    }
    await this.task_runtime.publish_progress(handle, items.map(read_task_item_id), next_run);
    return next_run;
  }

  /**
   * 根据任务模式和当前 item 状态创建翻译进度初始值
   */
  private build_translation_progress(
    mode: string,
    items: TextTaskItemRecord[],
    previous_progress: BatchTranslationProgress,
  ): BatchTranslationProgress {
    const total_line = items.filter(
      (item) => !is_task_skipped_item_status(read_task_item_status(item)),
    ).length;
    const processed_line = items.filter(
      (item) => read_task_item_status(item) === "PROCESSED",
    ).length;
    const error_line = items.filter((item) => read_task_item_status(item) === "ERROR").length;
    const previous =
      mode === "continue" ? previous_progress : TranslationProgressAccumulator.empty();
    return TranslationProgressAccumulator.with_counts(
      {
        ...previous,
        start_time:
          mode === "continue" && previous.time > 0
            ? Date.now() / 1000 - previous.time
            : Date.now() / 1000,
      },
      { total_line, processed_line, error_line },
    );
  }

  /**
   * 翻译结束时只持久化进度 extras，不额外触发 item patch
   */
  private async update_translation_progress_if_current(
    handle: BatchTranslationRunHandle,
    progress: BatchTranslationProgress,
  ): Promise<void> {
    if (!this.task_runtime.is_current(handle.run_id)) {
      return;
    }
    this.task_store.update_translation_progress(progress);
  }

  /**
   * 用本轮快照打印普通模型的主提示词；实际请求由 worker 同步构造，Sakura 使用专用路径。
   */
  private log_task_run_start(
    run_context: BatchTranslationRunContext,
    quality_snapshot: TextQualitySnapshot,
    app_language: unknown,
  ): void {
    let prompt_text: string | null = null;
    if (String(run_context.model["api_format"] ?? "") !== "SakuraLLM") {
      prompt_text = new PromptBuilder(
        this.builtin_root,
        normalize_setting_snapshot(run_context.config_snapshot),
        quality_snapshot,
        [],
      ).build_main();
    }
    this.log_replay.task_run_start(run_context.model, app_language, prompt_text);
  }

  /**
   * 解析任务限流器；同一模型配置下后台任务共享并发和 RPM 节奏
   */
  private resolve_task_limiter(model: MutableJsonRecord): TranslationLimiter {
    return this.limiter_pool.resolve(model);
  }

  /**
   * 重试超限后只标记 ERROR，译文字段继续只承载真实译文
   */
  private mark_translation_item_error(item: TextTaskItemRecord): void {
    item["status"] = "ERROR";
  }
}
