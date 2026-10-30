import type { LLMClientPort } from "../../llm/llm-types";
import type { ChatGPTAuthService } from "../../auth/chatgpt-auth-service";
import type { LogManager } from "../../log/log-manager";
import type { ProjectExecutionSettings } from "../../../domain/project-settings";
import type {
  TranslationModelSnapshot,
  WorkUnitExecutor,
  WorkUnitExecutionResult,
} from "../protocol/work-unit";
import type { BatchTranslationRuntime } from "../batch-translation-runtime";
import type { BatchTranslationProjectStore } from "../batch-translation-project-store";
import type { TranslationPlanner } from "../planning/translation-planner";
import type { TextQualitySnapshot, TextTaskItemRecord } from "../../../shared/text/text-processing";
import { AppError } from "../../../shared/error";
import { prepare_translation_targets } from "../planning/translation-targets";

import type { BatchTranslationRunHandle } from "../batch-translation-runtime";
import type {
  BatchTranslationOperation,
  BatchTranslationStartMode,
  BatchTranslationResult,
} from "../../../domain/batch-translation";
import { PromptBuilder } from "../work-unit/work-unit-prompt-builder";
import type {
  BatchTranslationProgress,
  BatchTranslationRunProgress,
} from "../../../domain/batch-translation";
import type { TranslationCommitEntry } from "./translation-pipeline";
import type { TranslationContext } from "../planning/translation-plan-types";
import { plan_translation_retry } from "../planning/translation-retry";
import { RequestRatePool } from "./request-rate";
import { TranslationRequestScheduler } from "./translation-request-scheduler";
import { TranslationPipeline } from "./translation-pipeline";
import { TranslationProgressAccumulator } from "./progress-accumulator";
import { TranslationLogReplay } from "./log-replay";
import { is_task_skipped_item_status } from "../../../domain/batch-translation";

import { read_task_item_status, read_task_item_id } from "../translation-item";
import type { ItemStatus } from "../../../domain/item";

/** 入口已解析状态条件；执行目的仅控制提交副作用。 */
export type BatchTranslationRunCommand = Readonly<{
  operation: BatchTranslationOperation;
  mode: BatchTranslationStartMode;
  item_ids?: readonly number[];
  item_statuses?: readonly ItemStatus[];
}>;

/** Service 在运行 lease 内准备的单次执行上下文，Runner 与 worker 共用。 */
export type BatchTranslationRunContext = Readonly<{
  config_snapshot: ProjectExecutionSettings;
  model: TranslationModelSnapshot;
}>;

/**
 * BatchTranslationRunner 依赖由 BackendServices 注入，保证后台任务只通过固定端口读写工程事实
 */
export interface BatchTranslationRunnerOptions {
  auth?: Pick<ChatGPTAuthService, "bind">;
  builtinRoot: string; // 用于任务启动日志读取提示词模板，保持宿主与 worker 内置资产根一致
  taskStore: Pick<
    BatchTranslationProjectStore,
    | "build_quality_snapshot"
    | "commit_translation_batch"
    | "get_translation_items"
    | "update_translation_progress"
  >; // 任务编排器只依赖项目任务事实的公开能力
  taskRuntime: Pick<
    BatchTranslationRuntime,
    | "update_request_state"
    | "is_current"
    | "publish_targets"
    | "publish_progress"
    | "read_run_progress"
    | "publish_status"
    | "publish_config"
    | "read_progress"
  >; // 任务锁、取消、快照和请求压力的最小能力集合
  llmClient: LLMClientPort; // 每轮请求调度器使用的单次网络请求入口。
  executorClient: WorkUnitExecutor; // 屏蔽 worker_threads 与直接 runner 的传输差异
  taskPlanner: Pick<TranslationPlanner, "build_translation_plan">; // 精确 token 切块、cache 复用和后台规划的最小能力集合
  logManager: Pick<LogManager, "append">; // 生命周期与批次日志共用结构化追加入口。
}

/**
 * Backend Runtime 与 CLI 共用的翻译调度、限流、重试和提交循环
 */
export class BatchTranslationRunner {
  private readonly auth: BatchTranslationRunnerOptions["auth"]; // 任务启动时绑定共享账户会话。
  private readonly builtin_root: string; // 让 Backend 启动日志和 worker 使用同一套内置提示词
  private readonly task_store: BatchTranslationRunnerOptions["taskStore"]; // 后台任务唯一项目数据写入口，BatchTranslationRunner 不直接碰 database
  private readonly task_runtime: BatchTranslationRunnerOptions["taskRuntime"]; // 任务锁、取消、快照与请求压力的最小运行态能力
  private readonly executor_client: WorkUnitExecutor; // 屏蔽 worker_threads / in_process runner 差异，主流程只关心 work-unit 结果
  private readonly task_planner: BatchTranslationRunnerOptions["taskPlanner"]; // 初始切块与 token 缓存复用入口。
  private readonly log_replay: TranslationLogReplay; // 统一处理任务生命周期日志和 worker 日志回放
  private readonly rate_pool = new RequestRatePool(); // 同一模型资源跨任务复用速率时钟。
  private readonly llm_client: BatchTranslationRunnerOptions["llmClient"]; // 父线程真实请求入口，由本轮调度器统一派发。
  /**
   * 注入任务执行依赖，保证任务数据写入口和 work-unit executor 边界可测试
   */
  public constructor(options: BatchTranslationRunnerOptions) {
    this.builtin_root = options.builtinRoot;
    this.task_store = options.taskStore;
    this.task_runtime = options.taskRuntime;
    this.executor_client = options.executorClient;
    this.llm_client = options.llmClient;
    this.auth = options.auth;
    this.task_planner = options.taskPlanner;
    this.log_replay = new TranslationLogReplay(options.logManager);
  }

  /**
   * 翻译主流程：冻结筛选目标后共享执行链，执行目的决定提交副作用。
   */
  public async run(
    handle: BatchTranslationRunHandle,
    command: BatchTranslationRunCommand,
    run_context: BatchTranslationRunContext,
  ): Promise<BatchTranslationResult> {
    let final_status: "done" | "stopped" | "error" = "done";
    let app_language: unknown = "ZH";
    let progress = await this.task_runtime.read_progress(); // 工程累计事实，由项目写入口维护。
    const errors: unknown[] = []; // 按发生顺序收集，首项作为聚合异常的主因。
    const retranslate = command.operation === "retranslate";
    const mode = command.mode;
    try {
      const auth_session = run_context.model.auth_type === "oauth" ? this.auth?.bind() : undefined;
      if (run_context.model.auth_type === "oauth" && auth_session === undefined)
        throw new Error("ChatGPT authentication is not configured");
      await this.task_runtime.publish_status(handle, "running");
      await this.task_runtime.publish_config(handle, {
        model_name: run_context.model.name,
        model_id: run_context.model.model_id,
        thinking_level: run_context.model.thinking.level,
        source_language: run_context.config_snapshot.source_language,
        target_language: run_context.config_snapshot.target_language,
      });
      app_language = run_context.config_snapshot["app_language"];
      const quality_snapshot = this.task_store.build_quality_snapshot();
      this.log_task_run_start(run_context, quality_snapshot, app_language);
      const items = this.task_store.get_translation_items();
      const prepared = prepare_translation_targets(
        items,
        command.item_ids,
        command.item_statuses,
        mode === "reset",
      );
      progress = this.build_translation_progress(mode, items, progress);
      await this.update_translation_progress_if_current(handle, progress);
      let run_progress = await this.task_runtime.publish_targets(handle, prepared.target_ids);
      const contexts = await this.task_planner.build_translation_plan(
        prepared.items,
        run_context.config_snapshot,
        run_context.model,
        handle.signal,
        prepared.target_ids,
      );
      const rate = this.rate_pool.resolve(run_context.model);
      const request_scheduler = new TranslationRequestScheduler({
        ...(auth_session === undefined ? {} : { auth_session }),
        model: run_context.model,
        client: this.llm_client,
        rate,
        on_state: (state) => this.task_runtime.update_request_state(handle, state),
        on_failure: (key_index, error) =>
          this.log_replay.request_failure(key_index, error, app_language),
      });
      const pipeline = new TranslationPipeline({
        read_concurrency_limit: () => request_scheduler.read_concurrency_limit(),
        signal: handle.signal,
        execute: (context, signal) =>
          this.execute_translation_context(
            handle,
            context,
            run_context,
            quality_snapshot,
            request_scheduler,
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
        // 原始失败经完成链交给调用方，日志只做诊断。
        errors.push(error);
        try {
          this.log_replay.task_error(
            retranslate ? "重翻任务执行失败。" : "翻译任务执行失败。",
            error,
          );
        } catch (log_error) {
          errors.push(log_error);
        }
      }
    } finally {
      try {
        // 提交后事件失败也可能已写入数据库，最终统计读取真实已提交事实。
        progress = TranslationProgressAccumulator.with_elapsed(
          await this.task_runtime.read_progress(),
        );
        await this.update_translation_progress_if_current(handle, progress);
        const run_progress = this.task_runtime.read_run_progress();
        // 目标发布前没有本次统计，准备失败不能生成虚假的零目标。
        if (run_progress !== undefined)
          await this.task_runtime.publish_progress(
            handle,
            [],
            TranslationProgressAccumulator.with_elapsed(run_progress),
          );
      } catch (error) {
        errors.push(error);
      }
      try {
        this.log_replay.task_run_finish(final_status, app_language);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0)
      throw errors.length === 1
        ? errors[0]
        : new AggregateError(errors, "Batch translation failed.", { cause: errors[0] });
    const run_progress = this.task_runtime.read_run_progress();
    return {
      status: final_status,
      progress: { ...progress },
      ...(run_progress === undefined ? {} : { run_progress }),
    };
  }

  /**
   * 执行翻译 chunk，并把失败条目转换成高优重试上下文
   */
  private async execute_translation_context(
    handle: BatchTranslationRunHandle,
    context: TranslationContext,
    run_context: BatchTranslationRunContext,
    quality_snapshot: TextQualitySnapshot,
    request_scheduler: TranslationRequestScheduler,
    signal: AbortSignal,
  ) {
    const result = await this.executor_client.execute_unit(
      {
        run_id: handle.run_id,
        unit_id: context.work_unit_id,
        kind: "translation",
        model: run_context.model,
        config_snapshot: run_context.config_snapshot,
        quality_snapshot,
        payload: {
          items: context.items,
          precedings: context.precedings,
          followings: context.followings,
        },
      },
      signal,
      request_scheduler,
    );
    this.log_replay.work_unit_logs(result.logs);
    return this.build_translation_worker_result(context, result);
  }

  /**
   * 翻译 worker 结果拆成成功条目、耗尽 ID 与需要重试的上下文。
   */
  private build_translation_worker_result(
    context: TranslationContext,
    result: WorkUnitExecutionResult,
  ) {
    if (result.outcome === "stopped") {
      return { commit_entries: [], retry_contexts: [] };
    }
    const returned_items = result.output.items.length > 0 ? result.output.items : context.items;
    const commit_items = returned_items.filter(
      (item) => read_task_item_status(item) === "PROCESSED",
    );
    const retry_plan = plan_translation_retry(context, returned_items);
    // 用量与条目终态独立提交，内容重试也保留已经报告的消耗。
    const has_usage = Object.values(result.metrics).some((tokens) => tokens > 0);
    return {
      commit_entries:
        commit_items.length > 0 || retry_plan.exhausted_item_ids.length > 0 || has_usage
          ? [
              {
                items: commit_items,
                exhausted_item_ids: retry_plan.exhausted_item_ids,
                ...result.metrics,
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
    run_progress: BatchTranslationRunProgress,
    affects_proofreading: boolean,
  ): Promise<BatchTranslationRunProgress> {
    if (!this.task_runtime.is_current(handle.run_id) || entries.length === 0) {
      return run_progress;
    }
    const items = entries.flatMap((entry) => entry.items);
    const exhausted_item_ids = entries.flatMap((entry) => entry.exhausted_item_ids);
    const settled_ids = [...items.map(read_task_item_id), ...exhausted_item_ids];
    let next_progress = await this.task_runtime.read_progress(); // 每次提交从权威累计事实继续。
    let next_run: BatchTranslationRunProgress = {
      ...run_progress,
      processed_line: run_progress.processed_line + items.length,
      failed_line: run_progress.failed_line + exhausted_item_ids.length,
    };
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
      await this.task_store.commit_translation_batch(items, next_progress, affects_proofreading);
    } catch (error) {
      // 事务已经提交但事件同步失败时，本轮结果仍然成立；保留原始诊断。
      if (error instanceof AppError && error.code === "data.committed_sync_failed") {
        try {
          await this.task_runtime.publish_progress(handle, settled_ids, next_run);
        } catch (publish_error) {
          throw new AggregateError(
            [error, publish_error],
            "Committed translation publication failed.",
            { cause: error },
          );
        }
      }
      throw error;
    }
    await this.task_runtime.publish_progress(handle, settled_ids, next_run);
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
    const previous =
      mode === "continue" ? previous_progress : TranslationProgressAccumulator.empty();
    return {
      ...previous,
      total_line,
      processed_line,
      start_time:
        mode === "continue" && previous.time > 0
          ? Date.now() / 1000 - previous.time
          : Date.now() / 1000,
    };
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
    await this.task_store.update_translation_progress(progress);
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
        run_context.config_snapshot,
        quality_snapshot,
        [],
      ).build_main();
    }
    this.log_replay.task_run_start(run_context.model, app_language, prompt_text);
  }
}
