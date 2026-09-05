import { Model } from "../../../domain/model";
import type { TranslationModelSnapshot } from "../protocol/work-unit";
import type { TextQualitySnapshot } from "../../../shared/text/text-types";
import type { TextTaskItemRecord } from "../../../shared/text/text-types";
import crypto from "node:crypto";

import { resolve_model_for_usage } from "../../model/model-config-resolver";
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

import { normalize_setting_snapshot, type SettingSnapshot } from "../../../domain/setting";
import * as AppErrors from "../../../shared/error";
import { read_task_item_status } from "../translation-item";

const TRANSLATION_TERMINAL_STATUSES = new Set(["PROCESSED", "ERROR"]); // 翻译终态只认已处理和错误，跳过类状态不参与重试终结判断

const TRANSLATION_RETRY_LIMIT = 3; // 单条翻译在拆分后最多重试三次。

const DEFAULT_INPUT_TOKEN_LIMIT = 512; // 模型未配置 token 限制时使用保守默认值，避免一次塞入过长 prompt
// 一次任务启动时冻结配置和模型，运行中不跟随设置页热变更
interface BatchTranslationRunContext {
  config_snapshot: SettingSnapshot; // 本轮设置只读快照，提示词和 runner 共用
  model: TranslationModelSnapshot; // 本轮激活模型，避免设置热变更切换请求资源
}

/**
 * Backend Runtime 与 CLI 共用的翻译调度、限流、重试和提交循环
 */
export class BatchTranslationRunner {
  private readonly builtin_root: string; // 让 Backend 启动日志和 worker 使用同一套内置提示词
  private readonly task_store: BatchTranslationRunnerOptions["taskStore"]; // 后台任务唯一项目数据写入口，BatchTranslationRunner 不直接碰 database
  private readonly task_runtime: BatchTranslationRunnerOptions["taskRuntime"]; // 任务锁、取消、快照与请求压力的最小运行态能力
  private readonly executor_client: WorkUnitExecutor; // 屏蔽 worker_threads / in_process runner 差异，主流程只关心 work-unit 结果
  private readonly task_planner: BatchTranslationRunnerOptions["taskPlanner"]; // 切块与 token cache 复用的唯一规划入口
  private readonly app_setting_service: BatchTranslationRunnerOptions["AppSettingService"]; // 每轮启动时读取一次设置与模型快照
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
    this.app_setting_service = options.AppSettingService;
    this.log_replay = new TranslationLogReplay(options.logManager);
  }

  /**
   * 翻译主流程：普通翻译与重翻共享执行链，scope 只决定输入集合及是否推进校对 revision
   */
  public async run(
    handle: BatchTranslationRunHandle,
    command: BatchTranslationStartCommand,
  ): Promise<BatchTranslationResult> {
    let final_status: "done" | "idle" | "error" = "done";
    let app_language: unknown = "ZH";
    let progress = this.task_runtime.read_progress();
    const infrastructure_errors: unknown[] = [];
    let release_database_lease: (() => void) | null = null; // 只负责释放本轮任务连接租约，不承载任务状态
    const mode = command.mode;
    const translation_scope = command.scope;
    const retranslate = translation_scope.kind === "items";
    try {
      await this.task_runtime.publish_status(handle, "running");
      release_database_lease = this.task_store.acquire_project_lease(
        `task:${handle.run_id}:translation`,
      );
      const run_context = this.resolve_task_run_context();
      app_language = run_context.config_snapshot["app_language"];
      const quality_snapshot = this.task_store.build_quality_snapshot();
      await this.log_task_run_start(run_context, quality_snapshot, app_language);
      const payload =
        translation_scope.kind === "items"
          ? this.task_store.get_translation_items_by_scope(translation_scope.item_ids)
          : this.task_store.get_translation_items(mode);
      const all_items = payload.items;
      const previous_progress = payload.progress;
      const contexts = retranslate
        ? all_items.map((item) => this.build_retranslate_context(item))
        : await this.task_planner.build_translation_contexts(
            all_items,
            run_context.config_snapshot,
            run_context.model,
            handle.signal,
          );
      progress = retranslate
        ? this.build_retranslate_progress(all_items, previous_progress)
        : this.build_translation_progress(mode, all_items, previous_progress);
      await this.update_translation_progress_if_current(handle, progress);
      await this.task_runtime.publish_progress(handle);
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
          progress = await this.commit_translation_entries(handle, entries, progress, retranslate);
        },
      });
      await pipeline.run(contexts);
      if (handle.signal.aborted) {
        final_status = "idle";
      }
    } catch (error) {
      final_status = handle.signal.aborted ? "idle" : "error";
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
    return { status: final_status, progress: { ...progress } };
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
    progress: BatchTranslationProgress,
    affects_proofreading: boolean,
  ): Promise<BatchTranslationProgress> {
    if (!this.task_runtime.is_current(handle.run_id) || entries.length === 0) {
      return progress;
    }
    const items = entries.flatMap((entry) => entry.items);
    const processed_delta = items.filter(
      (item) => read_task_item_status(item) === "PROCESSED",
    ).length;
    const error_delta = items.filter((item) => read_task_item_status(item) === "ERROR").length;
    let next_progress = TranslationProgressAccumulator.with_counts(progress, {
      processed_line: progress.processed_line + processed_delta,
      error_line: progress.error_line + error_delta,
    });
    for (const entry of entries) {
      next_progress = TranslationProgressAccumulator.add_tokens(
        next_progress,
        entry.input_tokens,
        entry.reasoning_tokens,
        entry.output_tokens,
      );
    }
    next_progress = TranslationProgressAccumulator.with_elapsed(next_progress);
    const ack = await this.task_store.commit_translation_items(
      items,
      next_progress,
      affects_proofreading,
    );
    await this.task_runtime.publish_progress(handle, ack.changed_item_ids);
    return next_progress;
  }

  /**
   * 重翻每个 item 独立执行，保持行级 busy 状态能逐条收敛
   */
  private build_retranslate_context(item: TextTaskItemRecord): TranslationContext {
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
   * 重翻进度复用 translation_extras 的 token 累计，但本轮行数只看选中条目
   */
  private build_retranslate_progress(
    items: TextTaskItemRecord[],
    previous_progress: BatchTranslationProgress,
  ): BatchTranslationProgress {
    return TranslationProgressAccumulator.with_counts(
      { ...previous_progress, start_time: Date.now() / 1000 },
      { total_line: items.length, processed_line: 0, error_line: 0 },
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
   * 按任务用途读取当前配置和模型，作为一次 run 的不可变快照
   */
  private resolve_task_run_context(): BatchTranslationRunContext {
    const settings = this.app_setting_service.read_setting();
    const config_snapshot = normalize_setting_snapshot(settings);
    const model = resolve_model_for_usage(settings, "translation");
    if (model === null) {
      throw new AppErrors.AppError("model.not_found");
    }
    return { config_snapshot, model: { ...Model.from_json(model, "") } };
  }

  /**
   * 非 SakuraLLM 翻译启动时在 API 信息后打印本轮主提示词
   */
  private async log_task_run_start(
    run_context: BatchTranslationRunContext,
    quality_snapshot: TextQualitySnapshot,
    app_language: unknown,
  ): Promise<void> {
    const prompt_text = await this.build_task_start_prompt(run_context, quality_snapshot);
    this.log_replay.task_run_start(run_context.model, app_language, prompt_text);
  }

  /**
   * 启动提示词只用于诊断日志，实际请求仍由 worker 基于同一快照重新构造完整 messages
   */
  private async build_task_start_prompt(
    run_context: BatchTranslationRunContext,
    quality_snapshot: TextQualitySnapshot,
  ): Promise<string | null> {
    if (String(run_context.model["api_format"] ?? "") === "SakuraLLM") {
      return null;
    }
    const builder = new PromptBuilder(
      this.builtin_root,
      normalize_setting_snapshot(run_context.config_snapshot),
      quality_snapshot,
      [],
    );
    return await builder.build_main();
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
