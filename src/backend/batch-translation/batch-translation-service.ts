import type { BatchTaskListSnapshot, BatchTaskResult } from "../../domain/batch-task";
import type { BatchTaskRuntime, BatchTaskRunHandle } from "../batch-task/batch-task-runtime";
import type { LogWriter } from "../log/log-manager";
import { create_text_resolver } from "../../shared/i18n";
import { resolve_app_locale } from "../../domain/app-language";
import type {
  BatchTranslationRunner,
  BatchTranslationRunContext,
  BatchTranslationRunCommand,
} from "./core/batch-translation-runner";
import type { RuntimeLease } from "../runtime-operation-gate";
import type { AppSettingService } from "../app/app-setting-service";
import { Model } from "../../domain/model";
import { is_item_status } from "../../domain/item";
import { build_project_execution_settings } from "../../domain/project-settings";
import type { CacheReadPort } from "../cache/cache-types";
import { resolve_model_for_usage } from "../model/model-config-resolver";
import { AppError } from "../../shared/error";
import { is_json_record, type JsonRecord } from "../../domain/json";
import type {
  BatchTranslationStartCommand,
  AgentBatchTranslationRequest,
} from "../../domain/batch-translation";

/** 工作台、校对、CLI 和 Agent 共用的批量翻译入口。 */
export class BatchTranslationService {
  /** 组合翻译执行器、运行态与当前工程会话。 */
  public constructor(
    private readonly runner: Pick<BatchTranslationRunner, "run">,
    private readonly runtime: BatchTaskRuntime,
    private readonly settings: Pick<AppSettingService, "read_setting">,
    private readonly project_settings: CacheReadPort["settings"], // 已提交的工程设置
    private readonly log: Pick<LogWriter, "scope">,
  ) {}
  /** 收窄公开请求，返回受理结果与当前快照。 */
  public async start(request: JsonRecord): Promise<{
    accepted: true;
    run_id: string;
    batch_tasks: BatchTaskListSnapshot;
  }> {
    const handle = await this.start_current_project(this.normalize_command(request));
    return {
      accepted: true,
      run_id: handle.run_id,
      batch_tasks: this.runtime.build_snapshot(),
    };
  }
  /** 确认工程后预约独立运行，句柄用于等待完整收尾。 */
  public async start_current_project(
    command: BatchTranslationStartCommand,
  ): Promise<BatchTaskRunHandle> {
    // Runner 在异步生命周期内使用独立命令，调用方后续修改不改变已预约范围。
    const run_command: BatchTranslationRunCommand = {
      operation: command.operation,
      ...(command.scope.kind === "items" ? { item_ids: [...command.scope.item_ids] } : {}),
      ...(command.operation === "translate" ? { item_statuses: ["NONE"] } : {}),
    };
    const handle = this.runtime.begin_standalone(run_command.operation);
    return this.execute(handle, run_command);
  }
  /** 当前 Agent lease 内启动，并等待本轮完整收尾。 */
  public async run_under_agent(
    lease: RuntimeLease,
    signal: AbortSignal,
    model: Model,
    request: AgentBatchTranslationRequest,
    chat_id: string,
  ): Promise<BatchTaskResult> {
    const { item_ids: ids, item_statuses: statuses } = request;
    if (
      Object.keys(request).some((key) => key !== "item_ids" && key !== "item_statuses") ||
      (ids === undefined && statuses === undefined) ||
      (ids !== undefined &&
        (!Array.isArray(ids) ||
          ids.length === 0 ||
          ids.some((id) => typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0))) ||
      (statuses !== undefined &&
        (!Array.isArray(statuses) ||
          statuses.length === 0 ||
          statuses.some((status) => !is_item_status(status))))
    )
      throw new AppError("request.validation_failed");
    // 在首次 await 前复制筛选条件，调用方修改数组不能改变本轮目标。
    const item_ids = ids === undefined ? undefined : [...new Set(ids)];
    const item_statuses = statuses === undefined ? undefined : [...new Set(statuses)];
    const command: BatchTranslationRunCommand = {
      operation: item_statuses?.every((status) => status === "NONE") ? "translate" : "retranslate", // 重翻提交同时推进校对修订。
      ...(item_ids === undefined ? {} : { item_ids }),
      ...(item_statuses === undefined ? {} : { item_statuses }),
    };
    const handle = this.runtime.begin_under_agent(lease, signal, "translation", command.operation);
    return await (
      await this.execute(handle, command, { model, chat_id })
    ).completion;
  }
  /** 完成链包含进度和事件收尾，错误诊断之后统一输出结束提示。 */
  private async execute(
    handle: BatchTaskRunHandle,
    command: BatchTranslationRunCommand,
    agent?: Readonly<{ model: Model; chat_id: string }>,
  ): Promise<BatchTaskRunHandle> {
    const run_log = this.log.scope({
      run_id: handle.run_id,
      ...(agent === undefined ? {} : { chat_id: agent.chat_id }),
    });
    let app_language: unknown;
    const completion = handle.completion
      .catch((error: unknown) => {
        run_log.append({
          level: "error",
          source: "engine",
          content:
            command.operation === "retranslate" ? "重翻任务执行失败。" : "翻译任务执行失败。",
          error,
        });
        throw error;
      })
      .finally(() => {
        const t = create_text_resolver(resolve_app_locale(app_language));
        run_log.append({
          level: "info",
          source: "engine",
          content: t("app.log.batch_translation_ended"),
        });
      });
    void completion.catch(() => undefined); // 独立入口只返回受理，调用方可稍后等待完成。
    await this.runtime.execute(handle, () => {
      const context = this.read_run_context(agent?.model);
      app_language = context.config_snapshot.app_language;
      return this.runner.run(handle, command, context, run_log);
    });
    return Object.freeze({ ...handle, completion });
  }

  /** 运行 lease 内组合应用设置与项目语言并准备模型，本轮执行固定使用该快照。 */
  private read_run_context(model?: Model): BatchTranslationRunContext {
    const settings = this.settings.read_setting();
    const raw_model = model?.to_json() ?? resolve_model_for_usage(settings, "translation");
    if (raw_model === null) throw new AppError("model.not_found");
    return {
      config_snapshot: build_project_execution_settings(
        settings,
        this.project_settings.readBlock(),
      ),
      model: { ...Model.from_json(raw_model, "") },
    };
  }

  /** 公开入口统一校验目的和范围，拒绝无效 ID，去重后保留首次顺序。 */
  private normalize_command(request: JsonRecord): BatchTranslationStartCommand {
    const operation = request["operation"];
    if (operation !== "translate" && operation !== "retranslate")
      throw new AppError("request.validation_failed");
    if (Object.keys(request).some((key) => key !== "operation" && key !== "scope"))
      throw new AppError("request.validation_failed");
    const raw = request["scope"];
    if (!is_json_record(raw)) throw new AppError("request.validation_failed");
    let scope: BatchTranslationStartCommand["scope"];
    if (raw["kind"] === "all" && Object.keys(raw).length === 1) {
      scope = { kind: "all" };
    } else if (
      raw["kind"] === "items" &&
      Array.isArray(raw["item_ids"]) &&
      Object.keys(raw).every((key) => key === "kind" || key === "item_ids")
    ) {
      const ids = raw["item_ids"];
      if (
        ids.length === 0 ||
        ids.some((id) => typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0)
      )
        throw new AppError("request.validation_failed");
      scope = { kind: "items", item_ids: [...new Set(ids as number[])] };
    } else throw new AppError("request.validation_failed");
    if (operation === "retranslate") {
      if (scope.kind !== "items") throw new AppError("request.validation_failed");
      return { operation, scope };
    }
    return { operation, scope };
  }
}
