import { read_request_timeout_ms } from "../../llm/llm-request";
import type { LLMRequestBody, LLMRequestResult, LLMClientPort } from "../../llm/llm-types";
import type { ChatGPTAuthService } from "../../auth/chatgpt-auth-service";
import type { LogWriter } from "../../log/log-manager";
import type { ProjectExecutionSettings } from "../../../domain/project-settings";
import type {
  TranslationModelSnapshot,
  WorkUnitExecutor,
  WorkUnitExecutionResult,
} from "../protocol/work-unit";
import type { BatchTaskRuntime, BatchTaskRunHandle } from "../../batch-task/batch-task-runtime";
import { empty_batch_task_progress, type BatchTaskProgress } from "../../../domain/batch-task";
import type { BatchTranslationOperation } from "../../../domain/batch-translation";
import type { BatchTranslationProjectStore } from "../batch-translation-project-store";
import type { TranslationPlanner } from "../planning/translation-planner";
import type { TextQualitySnapshot } from "../../../shared/text/text-processing";
import { AppError } from "../../../shared/error";
import { prepare_translation_targets } from "../planning/translation-targets";

import { PromptBuilder } from "../work-unit/work-unit-prompt-builder";
import type { TranslationCommitEntry } from "./translation-pipeline";
import type { TranslationContext } from "../planning/translation-plan-types";
import { plan_translation_retry } from "../planning/translation-retry";
import type { BatchRequestPool, RequestPoolSession } from "../../batch-task/batch-request-pool";
import { TranslationPipeline } from "./translation-pipeline";
import { log_batch_task_start, log_batch_request_failure } from "../../batch-task/batch-task-log";
import { create_text_resolver, type TextResolver } from "../../../shared/i18n";
import { resolve_app_locale } from "../../../domain/app-language";

import { read_task_item_status, read_task_item_id } from "../translation-item";
import type { ItemStatus } from "../../../domain/item";

/** 入口已解析状态条件；执行目的仅控制提交副作用。 */
export type BatchTranslationRunCommand = Readonly<{
  operation: BatchTranslationOperation;
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
  requestPool: BatchRequestPool;
  auth?: Pick<ChatGPTAuthService, "bind">;
  builtinRoot: string; // 用于任务启动日志读取提示词模板，保持宿主与 worker 内置资产根一致
  taskStore: Pick<
    BatchTranslationProjectStore,
    "build_quality_snapshot" | "commit_translation_batch" | "get_translation_items"
  >; // 任务编排器只依赖项目任务事实的公开能力
  taskRuntime: Pick<
    BatchTaskRuntime,
    "update_request_state" | "update_endpoint" | "publish_progress" | "publish_running"
  >; // 任务锁、取消、快照和请求压力的最小能力集合
  llmClient: LLMClientPort; // 共享请求池使用的单次网络请求入口。
  executorClient: WorkUnitExecutor; // 屏蔽 worker_threads 与直接 runner 的传输差异
  taskPlanner: Pick<TranslationPlanner, "build_translation_plan">; // 精确 token 切块、cache 复用和后台规划的最小能力集合
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
  private readonly request_pool: BatchRequestPool;
  private readonly llm_client: BatchTranslationRunnerOptions["llmClient"]; // 父线程真实请求入口，由共享请求池统一派发。
  /**
   * 注入任务执行依赖，保证任务数据写入口和 work-unit executor 边界可测试
   */
  public constructor(options: BatchTranslationRunnerOptions) {
    this.request_pool = options.requestPool;
    this.builtin_root = options.builtinRoot;
    this.task_store = options.taskStore;
    this.task_runtime = options.taskRuntime;
    this.executor_client = options.executorClient;
    this.llm_client = options.llmClient;
    this.auth = options.auth;
    this.task_planner = options.taskPlanner;
  }

  /**
   * 翻译主流程：冻结筛选目标后共享执行链，执行目的决定提交副作用。
   */
  public async run(
    handle: BatchTaskRunHandle,
    command: BatchTranslationRunCommand,
    run_context: BatchTranslationRunContext,
    log: Pick<LogWriter, "append">,
  ): Promise<"done" | "stopped"> {
    const retranslate = command.operation === "retranslate";
    try {
      const auth_session = run_context.model.auth_type === "oauth" ? this.auth?.bind() : undefined;
      if (run_context.model.auth_type === "oauth" && auth_session === undefined)
        throw new Error("ChatGPT authentication is not configured");
      await this.task_runtime.publish_running(handle);
      const t = create_text_resolver(resolve_app_locale(run_context.config_snapshot.app_language));
      const quality_snapshot = this.task_store.build_quality_snapshot();
      this.log_task_run_start(log, run_context, quality_snapshot, t);
      const items = this.task_store.get_translation_items();
      const prepared = prepare_translation_targets(items, command.item_ids, command.item_statuses);
      let run_progress = empty_batch_task_progress("item", prepared.target_ids.size);
      const pending_ids = retranslate ? prepared.target_ids : undefined;
      await this.task_runtime.publish_progress(
        handle,
        run_progress,
        pending_ids === undefined ? undefined : [...pending_ids],
      );
      const contexts = await this.task_planner.build_translation_plan(
        prepared.items,
        run_context.config_snapshot,
        run_context.model,
        handle.signal,
        prepared.target_ids,
      );
      const session = this.request_pool.open_session({
        model: run_context.model,
        timeout_ms: read_request_timeout_ms(run_context.config_snapshot),
        dispatch: (body: LLMRequestBody, key, signal) =>
          this.llm_client.request(
            {
              ...body,
              ...(auth_session === undefined ? {} : { auth_session }),
              model: { ...run_context.model, api_key: key },
            },
            signal,
            (model) =>
              this.task_runtime.update_endpoint(handle, {
                id: run_context.model.id,
                name: run_context.model.name || model.model_id,
                ...model,
              }),
          ),
        on_state: (state) => this.task_runtime.update_request_state(handle, state),
        on_failure: (key_index, error) =>
          log_batch_request_failure(log, "engine", key_index, error, t),
      });
      const pipeline = new TranslationPipeline({
        read_concurrency_limit: () => session.read_concurrency_limit(),
        signal: handle.signal,
        execute: (context, signal) =>
          this.execute_translation_context(
            handle,
            context,
            run_context,
            quality_snapshot,
            session,
            signal,
            log,
          ),
        commit: async (entries) => {
          run_progress = await this.commit_translation_entries(
            handle,
            entries,
            run_progress,
            pending_ids,
          );
        },
      });
      try {
        await pipeline.run(contexts);
      } finally {
        session.close();
      }
    } catch (error) {
      if (!handle.signal.aborted) throw error;
    }
    return handle.signal.aborted ? "stopped" : "done";
  }

  /**
   * 执行翻译 chunk，并把失败条目转换成高优重试上下文
   */
  private async execute_translation_context(
    handle: BatchTaskRunHandle,
    context: TranslationContext,
    run_context: BatchTranslationRunContext,
    quality_snapshot: TextQualitySnapshot,
    session: RequestPoolSession<LLMRequestBody, LLMRequestResult>,
    signal: AbortSignal,
    log: Pick<LogWriter, "append">,
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
      session,
    );
    for (const entry of result.logs) log.append({ ...entry, source: "engine-worker" });
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

  /** 提交条目后发布本轮进度，用量和耗尽尝试无需写库。 */
  private async commit_translation_entries(
    handle: BatchTaskRunHandle,
    entries: TranslationCommitEntry[],
    progress: BatchTaskProgress,
    pending_ids: Set<number> | undefined,
  ): Promise<BatchTaskProgress> {
    const items = entries.flatMap((entry) => entry.items);
    const exhausted_item_ids = entries.flatMap((entry) => entry.exhausted_item_ids);
    const next = {
      ...progress,
      succeeded: progress.succeeded + items.length,
      failed: progress.failed + exhausted_item_ids.length,
      time: Math.max(0, Date.now() / 1000 - progress.start_time),
      usage_complete: false,
    };
    for (const entry of entries) {
      next.input_tokens += Math.trunc(entry.input_tokens);
      next.reasoning_tokens += Math.trunc(entry.reasoning_tokens);
      next.output_tokens += Math.trunc(entry.output_tokens);
    }
    const publish = async () => {
      if (pending_ids !== undefined) {
        for (const item of items) pending_ids.delete(read_task_item_id(item));
        for (const item_id of exhausted_item_ids) pending_ids.delete(item_id);
      }
      await this.task_runtime.publish_progress(
        handle,
        next,
        pending_ids === undefined ? undefined : [...pending_ids],
      );
    };
    try {
      if (items.length > 0)
        await this.task_store.commit_translation_batch(items, pending_ids !== undefined);
    } catch (error) {
      // 事务可能已提交，仍发布真实的条目进度并保留原始同步错误。
      if (error instanceof AppError && error.code === "data.committed_sync_failed") {
        try {
          await publish();
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
    await publish();
    return next;
  }

  /**
   * 按本轮快照输出主提示词，Sakura 复用实际请求的系统指令。
   */
  private log_task_run_start(
    log: Pick<LogWriter, "append">,
    run_context: BatchTranslationRunContext,
    quality_snapshot: TextQualitySnapshot,
    t: TextResolver,
  ): void {
    const builder = new PromptBuilder(
      this.builtin_root,
      run_context.config_snapshot,
      quality_snapshot,
      [],
    );
    const prompt_text =
      run_context.model.api_format === "SakuraLLM"
        ? builder.generate_prompt_sakura("").messages[0]!.content
        : builder.build_main();
    log_batch_task_start(log, "engine", run_context.model, t);
    if (prompt_text.trim() !== "")
      log.append({ level: "info", source: "engine", content: prompt_text.trim() });
  }
}
