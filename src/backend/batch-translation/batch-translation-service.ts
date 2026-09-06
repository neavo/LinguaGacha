import type { ProjectSessionState } from "../project/project-session-state";
import type { BatchTranslationRunner } from "./core/batch-translation-runner";
import type {
  BatchTranslationRuntime,
  BatchTranslationRunHandle,
} from "./batch-translation-runtime";
import type { RuntimeLease } from "../runtime-operation-gate";
import type { AppSettingService } from "../app/app-setting-service";
import type { BatchTranslationRunContext } from "./core/batch-translation-runner-options";
import { Model } from "../../domain/model";
import { normalize_setting_snapshot } from "../../domain/setting";
import { resolve_model_for_usage } from "../model/model-config-resolver";
import { AppError } from "../../shared/error";
import {
  is_json_record,
  type JsonRecord,
  type JsonValue,
  type MutableJsonRecord,
} from "../../domain/json";
import {
  is_batch_translation_start_mode,
  resolve_batch_translation_start_mode,
  type BatchTranslationStartCommand,
  type AgentBatchTranslationRequest,
  type BatchTranslationResult,
  type BatchTranslationSnapshot,
  type BatchTranslationSnapshotListener,
} from "../../domain/batch-translation";

/** 工作台、校对、CLI 和 Agent 共用的批量翻译入口。 */
export class BatchTranslationService {
  /** 组合翻译执行器、运行态与当前工程会话。 */
  public constructor(
    private readonly runner: BatchTranslationRunner,
    private readonly runtime: BatchTranslationRuntime,
    private readonly session: ProjectSessionState,
    private readonly settings: Pick<AppSettingService, "read_setting">,
  ) {}
  /** 转接共享运行态的快照订阅。 */
  public subscribe(listener: BatchTranslationSnapshotListener): () => void {
    return this.runtime.subscribe(listener);
  }
  /** 读取当前工程的完整翻译快照。 */
  public async snapshot(): Promise<BatchTranslationSnapshot> {
    return await this.runtime.build_snapshot();
  }
  /** 收窄公开请求，返回受理结果与当前快照。 */
  public async start(request: JsonRecord): Promise<MutableJsonRecord> {
    await this.start_current_project(this.normalize_command(request));
    return { accepted: true, batch_translation: (await this.snapshot()) as unknown as JsonValue };
  }
  /** 确认工程后预约独立运行，句柄用于等待完整收尾。 */
  public async start_current_project(
    command: BatchTranslationStartCommand,
  ): Promise<BatchTranslationRunHandle> {
    this.session.require_loaded_project_path();
    // Runner 在异步生命周期内使用独立命令，调用方后续修改不改变已预约范围。
    const run_command = structuredClone(command);
    const handle = this.runtime.begin_standalone(run_command.scope, run_command.operation);
    await this.runtime.execute(handle, () =>
      this.runner.run(handle, run_command, this.read_run_context()),
    );
    return handle;
  }
  /** 当前 Agent lease 内启动，并等待本轮完整收尾。 */
  public async run_under_agent(
    lease: RuntimeLease,
    signal: AbortSignal,
    model: Model,
    request: AgentBatchTranslationRequest,
  ): Promise<BatchTranslationResult> {
    this.session.require_loaded_project_path();
    const command: BatchTranslationStartCommand = this.normalize_command({
      operation: "translate",
      scope: request.scope,
      include_errors: request.include_errors,
      mode: resolve_batch_translation_start_mode(this.runtime.read_progress()),
    });
    const handle = this.runtime.begin_under_agent(command.scope, lease, signal, command.operation);
    await this.runtime.execute(handle, () =>
      this.runner.run(handle, command, this.read_run_context(model)),
    );
    return await handle.completion;
  }
  /** 运行 lease 内统一准备设置与模型，跨入 Runner 时隔离嵌套配置引用。 */
  private read_run_context(model?: Model): BatchTranslationRunContext {
    const settings = this.settings.read_setting();
    const raw_model = model?.to_json() ?? resolve_model_for_usage(settings, "translation");
    if (raw_model === null) throw new AppError("model.not_found");
    return {
      config_snapshot: normalize_setting_snapshot(settings),
      model: { ...Model.from_json(raw_model, "") },
    };
  }

  /** 请求停止并回传权威快照。 */
  public async stop(): Promise<MutableJsonRecord> {
    const accepted = await this.runtime.request_stop();
    return { accepted, batch_translation: (await this.snapshot()) as unknown as JsonValue };
  }
  /** 包装 HTTP 与 SSE 共用的快照载荷。 */
  public async get_snapshot(): Promise<MutableJsonRecord> {
    return { batch_translation: (await this.snapshot()) as unknown as JsonValue };
  }
  /** 公开入口统一校验目的和范围，拒绝无效 ID，去重后保留首次顺序。 */
  private normalize_command(request: JsonRecord): BatchTranslationStartCommand {
    const operation = request["operation"];
    if (operation !== "translate" && operation !== "retranslate")
      throw new AppError("request.validation_failed");
    const allowed =
      operation === "translate"
        ? ["operation", "mode", "scope", "include_errors"]
        : ["operation", "scope"];
    if (Object.keys(request).some((key) => !allowed.includes(key)))
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
    const mode = request["mode"] ?? "new";
    const include_errors = request["include_errors"] ?? false;
    if (!is_batch_translation_start_mode(mode) || typeof include_errors !== "boolean")
      throw new AppError("request.validation_failed");
    return { operation, mode, scope, include_errors };
  }
}
