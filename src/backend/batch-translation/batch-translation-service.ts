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
    const handle = this.runtime.begin_standalone(command.scope);
    await this.runtime.execute(handle, () =>
      this.runner.run(handle, command, this.read_run_context()),
    );
    return handle;
  }
  /** 当前 Agent lease 内启动，并等待本轮完整收尾。 */
  public async run_under_agent(
    lease: RuntimeLease,
    signal: AbortSignal,
    model: Model,
  ): Promise<BatchTranslationResult> {
    this.session.require_loaded_project_path();
    const command: BatchTranslationStartCommand = {
      mode: resolve_batch_translation_start_mode(this.runtime.read_progress()),
      scope: { kind: "all" },
    };
    const handle = this.runtime.begin_under_agent(command.scope, lease, signal);
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
  /** 收窄启动模式与范围，定点 ID 去重保序且至少保留一项。 */
  private normalize_command(request: JsonRecord): BatchTranslationStartCommand {
    if (Object.keys(request).some((key) => key !== "mode" && key !== "scope"))
      throw new AppError("request.validation_failed");
    const mode = request["mode"] ?? "new";
    if (!is_batch_translation_start_mode(mode)) throw new AppError("request.validation_failed");
    const raw = request["scope"];
    if (raw === undefined) return { mode, scope: { kind: "all" } };
    if (!is_json_record(raw)) throw new AppError("request.validation_failed");
    if (raw["kind"] === "all") return { mode, scope: { kind: "all" } };
    if (raw["kind"] !== "items" || !Array.isArray(raw["item_ids"]))
      throw new AppError("request.validation_failed");
    const item_ids = [
      ...new Set(
        raw["item_ids"].flatMap((value) => {
          const parsed =
            typeof value === "number"
              ? value
              : typeof value === "string" && /^[+-]?\d+$/.test(value.trim())
                ? Number(value)
                : NaN;
          return Number.isInteger(parsed) && parsed > 0 ? [parsed] : [];
        }),
      ),
    ];
    if (item_ids.length === 0) throw new AppError("request.validation_failed");
    return { mode, scope: { kind: "items", item_ids } };
  }
}
