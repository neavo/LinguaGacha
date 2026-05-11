import type { ApiJsonValue } from "../api/api-types";
import { ConfigService } from "../service/config-service";
import { resolve_active_model } from "../model/model-config-resolver";
import { ProjectSessionState } from "../project/project-session-state";
import { TaskEngine } from "../task-engine/task-engine";
import { TaskRuntimeState } from "./task-runtime-state";
import { TaskSnapshotBuilder } from "./task-snapshot-builder";
import { type JsonRecord, type MutableJsonRecord } from "./task-types";

// 翻译和分析目前共享三种用户意图，但分开常量能避免未来枚举变更互相污染。
const TRANSLATION_MODES = new Set(["NEW", "CONTINUE", "RESET"]);
const ANALYSIS_MODES = new Set(["NEW", "CONTINUE", "RESET"]);

/**
 * 公开 `/api/tasks/*` 的 任务服务，负责校验请求、调用 Task Engine 并组装回执。
 */
export class TaskService {
  // task_engine 是后台任务生命周期、调度和停止的唯一执行权威。
  private readonly task_engine: TaskEngine;

  // snapshot_builder 是公开任务快照唯一组装口径，命令回执也复用它。
  private readonly snapshot_builder: TaskSnapshotBuilder;

  // task_runtime_state 负责命令受理后的乐观 busy 状态，避免回执等待 SSE。
  private readonly task_runtime_state: TaskRuntimeState;

  // session_state 决定重翻 revision 校验是否能定位当前工程。
  private readonly session_state: ProjectSessionState;

  // config_service 只用于单条翻译前的主动模型可用性检查。
  private readonly config_service: ConfigService;

  /**
   * 注入任务服务依赖，保持公开协议、运行态桥和配置读取边界可测试。
   */
  public constructor(
    task_engine: TaskEngine,
    snapshot_builder: TaskSnapshotBuilder,
    task_runtime_state: TaskRuntimeState,
    session_state: ProjectSessionState,
    config_service: ConfigService,
  ) {
    this.task_engine = task_engine;
    this.snapshot_builder = snapshot_builder;
    this.task_runtime_state = task_runtime_state;
    this.session_state = session_state;
    this.config_service = config_service;
  }

  /**
   * 启动翻译任务；公开回执由 TaskService 立即覆盖为 REQUEST。
   */
  public async start_translation(request: JsonRecord): Promise<MutableJsonRecord> {
    const mode = this.require_mode(request["mode"], TRANSLATION_MODES, "NEW");
    const quality_snapshot = this.normalize_optional_record(request["quality_snapshot"]);
    const previous_state = this.task_runtime_state.snapshot();
    this.task_runtime_state.begin_task("translation");
    try {
      await this.task_engine.start_translation(mode, quality_snapshot);
    } catch (error) {
      this.task_runtime_state.restore(previous_state);
      throw error;
    }
    return {
      accepted: true,
      task: (await this.snapshot_builder.build_command_ack(
        "translation",
        "REQUEST",
        true,
      )) as unknown as ApiJsonValue,
    };
  }

  /**
   * 请求停止翻译任务；停止态由任务流水线异步收尾。
   */
  public async stop_translation(_request: JsonRecord): Promise<MutableJsonRecord> {
    const previous_state = this.task_runtime_state.snapshot();
    this.task_runtime_state.mark_stopping("translation");
    try {
      await this.task_engine.stop_translation();
    } catch (error) {
      this.task_runtime_state.restore(previous_state);
      throw error;
    }
    return {
      accepted: true,
      task: (await this.snapshot_builder.build_command_ack(
        "translation",
        "STOPPING",
        true,
      )) as unknown as ApiJsonValue,
    };
  }

  /**
   * 启动分析任务；mode 校验保持公开任务枚举一致。
   */
  public async start_analysis(request: JsonRecord): Promise<MutableJsonRecord> {
    const mode = this.require_mode(request["mode"], ANALYSIS_MODES, "NEW");
    const quality_snapshot = this.normalize_optional_record(request["quality_snapshot"]);
    const previous_state = this.task_runtime_state.snapshot();
    this.task_runtime_state.begin_task("analysis");
    try {
      await this.task_engine.start_analysis(mode, quality_snapshot);
    } catch (error) {
      this.task_runtime_state.restore(previous_state);
      throw error;
    }
    return {
      accepted: true,
      task: (await this.snapshot_builder.build_command_ack(
        "analysis",
        "REQUEST",
        true,
      )) as unknown as ApiJsonValue,
    };
  }

  /**
   * 请求停止分析任务；公开层只表达 STOPPING 意图，不等待 Task Engine 终态。
   */
  public async stop_analysis(_request: JsonRecord): Promise<MutableJsonRecord> {
    const previous_state = this.task_runtime_state.snapshot();
    this.task_runtime_state.mark_stopping("analysis");
    try {
      await this.task_engine.stop_analysis();
    } catch (error) {
      this.task_runtime_state.restore(previous_state);
      throw error;
    }
    return {
      accepted: true,
      task: (await this.snapshot_builder.build_command_ack(
        "analysis",
        "STOPPING",
        true,
      )) as unknown as ApiJsonValue,
    };
  }

  /**
   * 启动批量重翻任务，TaskService 先完成 section revision 校验再交给 Task Engine。
   */
  public async start_retranslate(request: JsonRecord): Promise<MutableJsonRecord> {
    this.require_loaded_project_path();
    const item_ids = this.normalize_item_ids(request["item_ids"]);
    const quality_snapshot = this.normalize_optional_record(request["quality_snapshot"]);
    if (item_ids.length === 0) {
      throw new Error("请选择要重新翻译的条目。");
    }
    this.assert_expected_section_revisions(
      this.normalize_expected_section_revisions(request["expected_section_revisions"]),
    );
    const previous_state = this.task_runtime_state.snapshot();
    this.task_runtime_state.begin_task("retranslate", item_ids);
    try {
      await this.task_engine.start_retranslate(item_ids, quality_snapshot);
    } catch (error) {
      this.task_runtime_state.restore(previous_state);
      throw error;
    }
    return {
      accepted: true,
      task: (await this.snapshot_builder.build_command_ack("retranslate", "REQUEST", true, {
        retranslating_item_ids: item_ids as unknown as ApiJsonValue,
      })) as unknown as ApiJsonValue,
    };
  }

  /**
   * 显式读取任务快照；它是按需查询，不承担订阅职责。
   */
  public async get_task_snapshot(request: JsonRecord): Promise<MutableJsonRecord> {
    return {
      task: (await this.snapshot_builder.build_task_snapshot(request)) as unknown as ApiJsonValue,
    };
  }

  /**
   * 单条翻译用于页面派生工具，TaskService 先处理空文本和明显无激活模型的情况。
   */
  public async translate_single(request: JsonRecord): Promise<MutableJsonRecord> {
    const text = String(request["text"] ?? "").trim();
    if (text === "") {
      throw new Error("待翻译文本不能为空。");
    }
    if (!this.has_active_model()) {
      return { success: false, status: "NO_ACTIVE_MODEL", dst: "" };
    }
    return this.task_engine.translate_single(text);
  }

  /**
   * 当前 loaded 工程是重翻 revision 校验的唯一目标。
   */
  private require_loaded_project_path(): string {
    const state = this.session_state.snapshot();
    if (!state.loaded || state.projectPath === "") {
      throw new Error("工程未加载");
    }
    return state.projectPath;
  }

  /**
   * 缺失期望值时宽容跳过；给出期望值时沿用旧冲突消息。
   */
  private assert_expected_section_revisions(expected: Record<string, number> | null): void {
    if (expected === null) {
      return;
    }
    this.assert_expected_revision(
      "items",
      expected,
      this.snapshot_builder.get_runtime_section_revision("items"),
      (current, expected_revision) =>
        `运行态 revision 冲突：section=items 当前=${current.toString()} 期望=${expected_revision.toString()}`,
    );
    this.assert_expected_revision(
      "proofreading",
      expected,
      this.snapshot_builder.get_runtime_section_revision("proofreading"),
      (current, expected_revision) =>
        `校对 revision 冲突：当前=${current.toString()}，期望=${expected_revision.toString()}`,
    );
  }

  /**
   * 单个 section revision 比对集中在这里，避免两条错误消息分支重复转换。
   */
  private assert_expected_revision(
    section: string,
    expected: Record<string, number>,
    current_revision: number,
    build_message: (current: number, expected_revision: number) => string,
  ): void {
    if (!(section in expected)) {
      return;
    }
    const expected_revision = expected[section] ?? 0;
    if (current_revision !== expected_revision) {
      throw new Error(build_message(current_revision, expected_revision));
    }
  }

  /**
   * 请求模式只接受任务枚举值，非法值在 Gateway 边界映射为 invalid_request。
   */
  private require_mode(
    value: ApiJsonValue | undefined,
    allowed_modes: Set<string>,
    fallback: string,
  ): string {
    const mode = String(value ?? fallback);
    if (!allowed_modes.has(mode)) {
      throw new Error(`任务模式无效：${mode}`);
    }
    return mode;
  }

  /**
   * 只允许对象型质量快照穿过 executor 边界，数组和 null 都按缺失处理。
   */
  private normalize_optional_record(value: ApiJsonValue | undefined): ApiJsonValue {
    return this.is_record(value) ? { ...value } : null;
  }

  /**
   * item_ids 在公开边界去重并保留顺序，避免 Engine 收到重复重翻条目。
   */
  private normalize_item_ids(value: ApiJsonValue | undefined): number[] {
    if (!Array.isArray(value)) {
      return [];
    }
    const item_ids: number[] = [];
    const seen_ids = new Set<number>();
    for (const raw_item_id of value) {
      const item_id = this.parse_integer_like(raw_item_id);
      if (item_id === null || seen_ids.has(item_id)) {
        continue;
      }
      seen_ids.add(item_id);
      item_ids.push(item_id);
    }
    return item_ids;
  }

  /**
   * expected_section_revisions 必须是对象；对象内坏值直接按旧入口语义报错。
   */
  private normalize_expected_section_revisions(
    value: ApiJsonValue | undefined,
  ): Record<string, number> | null {
    if (!this.is_record(value)) {
      return null;
    }
    const revisions: Record<string, number> = {};
    for (const [section, revision] of Object.entries(value)) {
      revisions[section] = this.parse_integer_or_throw(revision);
    }
    return revisions;
  }

  /**
   * 单条翻译只做基础模型存在性判断；真实请求能力由 work-unit executor 负责。
   */
  private has_active_model(): boolean {
    const config = this.config_service.load_config();
    return resolve_active_model(config) !== null;
  }

  /**
   * 严格整数转换用于 revision 字段，避免坏锁值被静默吞掉。
   */
  private parse_integer_or_throw(value: ApiJsonValue | undefined): number {
    const parsed = this.parse_integer_like(value);
    if (parsed === null) {
      throw new Error(`整数值无效：${String(value)}`);
    }
    return parsed;
  }

  /**
   * 模拟历史 int：数字截断，整数字符串可转，布尔值按 1/0。
   */
  private parse_integer_like(value: ApiJsonValue | undefined): number | null {
    if (typeof value === "number") {
      return Number.isFinite(value) ? Math.trunc(value) : null;
    }
    if (typeof value === "boolean") {
      return value ? 1 : 0;
    }
    if (typeof value === "string" && /^[+-]?\d+$/.test(value.trim())) {
      return Number.parseInt(value, 10);
    }
    return null;
  }

  /**
   * JSON record 收窄集中处理，保护数组和 null 不进入业务判断。
   */
  private is_record(value: unknown): value is JsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}
