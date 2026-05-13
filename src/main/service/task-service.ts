import type { ApiJsonValue } from "../api/api-types";
import { SettingService } from "./setting-service";
import { resolve_active_model } from "../model/model-config-resolver";
import { ProjectSessionState } from "../project/project-session-state";
import { TaskEngine } from "../engine/core/engine";
import { TaskRuntimePublisher } from "../engine/runtime/task-runtime-publisher";
import { TaskSnapshotBuilder } from "../engine/runtime/task-snapshot-builder";
import { type JsonRecord, type MutableJsonRecord } from "../engine/runtime/task-runtime-types";
import type { StartTaskCommand, StopTaskCommand } from "../engine/protocol/task-command";
import { AnalysisTaskDefinition } from "../engine/definitions/analysis/analysis-task-definition";
import { TaskDefinitionRegistry } from "../engine/definitions/registry";
import { TranslationTaskDefinition } from "../engine/definitions/translation/translation-task-definition";
import {
  is_task_start_mode,
  is_task_type,
  type TaskStartMode,
  type TaskType,
  type TranslationScope,
} from "../engine/protocol/task-types";

/**
 * 公开 `/api/tasks/*` 的任务服务，负责校验命令、调用 TaskEngine 并组装回执
 */
export class TaskService {
  private readonly task_engine: TaskEngine; // task_engine 是后台任务生命周期、调度和停止的唯一执行权威

  private readonly snapshot_builder: TaskSnapshotBuilder; // snapshot_builder 是公开任务快照唯一组装口径，启动回执也复用它

  private readonly task_runtime_publisher: TaskRuntimePublisher; // task_runtime_publisher 是启动乐观态与失败回滚的唯一出口

  private readonly session_state: ProjectSessionState; // session_state 决定重翻 revision 校验是否能定位当前工程

  private readonly setting_service: SettingService; // setting_service 只用于单条翻译前的主动模型可用性检查

  private readonly task_definition_registry = new TaskDefinitionRegistry(); // task_definition_registry 是任务类型差异和 revision 依赖的唯一注册表

  /**
   * 注入任务命令依赖，保持公开协议、运行态桥和配置读取边界可测试
   */
  public constructor(
    task_engine: TaskEngine,
    snapshot_builder: TaskSnapshotBuilder,
    task_runtime_publisher: TaskRuntimePublisher,
    session_state: ProjectSessionState,
    setting_service: SettingService,
  ) {
    this.task_engine = task_engine;
    this.snapshot_builder = snapshot_builder;
    this.task_runtime_publisher = task_runtime_publisher;
    this.session_state = session_state;
    this.setting_service = setting_service;
    this.task_definition_registry.register(new TranslationTaskDefinition());
    this.task_definition_registry.register(new AnalysisTaskDefinition());
  }

  /**
   * 启动任务；公开层只做 JSON 收窄、revision 校验、模型检查和 Engine 命令转交
   */
  public async start_task(request: JsonRecord): Promise<MutableJsonRecord> {
    const command = this.normalize_start_command(request);
    const previous_state = this.task_runtime_publisher.snapshot_state();
    await this.task_runtime_publisher.begin_task(
      command.task_type,
      command.task_type === "translation" ? command.scope : { kind: "all" },
    );
    try {
      await this.task_engine.start(command);
    } catch (error) {
      await this.task_runtime_publisher.restore(previous_state);
      throw error;
    }
    return {
      accepted: true,
      task: (await this.snapshot_builder.build_command_ack(
        command.task_type,
        "requested",
        true,
      )) as unknown as ApiJsonValue,
    };
  }

  /**
   * 停止任务；回包必须读取当前真实 snapshot，避免 HTTP 晚于终态 SSE 时回写旧 stopping
   */
  public async stop_task(request: JsonRecord): Promise<MutableJsonRecord> {
    const command = this.normalize_stop_command(request);
    const previous_state = this.task_runtime_publisher.snapshot_state();
    try {
      await this.task_engine.stop(command);
    } catch (error) {
      await this.task_runtime_publisher.restore(previous_state);
      throw error;
    }
    return {
      accepted: true,
      task: (await this.snapshot_builder.build_task_snapshot({
        task_type: command.task_type,
      })) as unknown as ApiJsonValue,
    };
  }

  /**
   * 显式读取任务快照；它是按需查询，不承担订阅职责
   */
  public async get_task_snapshot(request: JsonRecord): Promise<MutableJsonRecord> {
    return {
      task: (await this.snapshot_builder.build_task_snapshot(request)) as unknown as ApiJsonValue,
    };
  }

  /**
   * 单条翻译用于页面派生工具，TaskService 先处理空文本和明显无激活模型的情况
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
   * 当前 loaded 工程是带 item scope 命令的唯一 revision 校验目标
   */
  private require_loaded_project_path(): string {
    const state = this.session_state.snapshot();
    if (!state.loaded || state.projectPath === "") {
      throw new Error("工程未加载");
    }
    return state.projectPath;
  }

  /**
   * 任务启动必须声明所有被读取 section 的 revision，避免后台任务基于过期输入运行
   */
  private assert_expected_section_revisions(
    expected: Record<string, number> | null,
    sections: string[],
  ): void {
    if (expected === null) {
      throw new Error("任务启动缺少 expected_section_revisions。");
    }
    for (const section of sections) {
      if (!(section in expected)) {
        throw new Error(`任务启动缺少 ${section} revision。`);
      }
      this.assert_expected_revision(
        section,
        expected,
        this.snapshot_builder.get_runtime_section_revision(section),
        (current, expected_revision) =>
          this.build_revision_conflict_message(section, current, expected_revision),
      );
    }
  }

  /**
   * 单个 section revision 比对集中在这里，避免错误消息分支重复转换
   */
  private assert_expected_revision(
    section: string,
    expected: Record<string, number>,
    current_revision: number,
    build_message: (current: number, expected_revision: number) => string,
  ): void {
    const expected_revision = expected[section] ?? 0;
    if (current_revision !== expected_revision) {
      throw new Error(build_message(current_revision, expected_revision));
    }
  }

  /**
   * 旧 items / proofreading 错误关键字保持不变，新增质量输入 revision 统一同一口径
   */
  private build_revision_conflict_message(
    section: string,
    current: number,
    expected_revision: number,
  ): string {
    if (section === "items") {
      return `运行态 revision 冲突：section=items 当前=${current.toString()} 期望=${expected_revision.toString()}`;
    }
    if (section === "proofreading") {
      return `校对 revision 冲突：当前=${current.toString()}，期望=${expected_revision.toString()}`;
    }
    return `${section} revision 冲突：当前=${current.toString()}，期望=${expected_revision.toString()}`;
  }

  /**
   * item_ids 在公开边界去重并保留顺序，避免 Engine 收到重复重翻条目
   */
  private normalize_item_ids(value: ApiJsonValue | undefined): number[] {
    if (!Array.isArray(value)) {
      return [];
    }
    const item_ids: number[] = [];
    const seen_ids = new Set<number>();
    for (const raw_item_id of value) {
      const item_id = this.parse_integer_like(raw_item_id);
      if (item_id === null || item_id <= 0 || seen_ids.has(item_id)) {
        continue;
      }
      seen_ids.add(item_id);
      item_ids.push(item_id);
    }
    return item_ids;
  }

  /**
   * expected_section_revisions 必须是对象；对象内坏值直接按旧入口语义报错
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
   * 单条翻译只做基础模型存在性判断；真实请求能力由 work-unit executor 负责
   */
  private has_active_model(): boolean {
    const config = this.setting_service.load_setting();
    return resolve_active_model(config) !== null;
  }

  /**
   * 严格整数转换用于 revision 字段，避免坏锁值被静默吞掉
   */
  private parse_integer_or_throw(value: ApiJsonValue | undefined): number {
    const parsed = this.parse_integer_like(value);
    if (parsed === null) {
      throw new Error(`整数值无效：${String(value)}`);
    }
    return parsed;
  }

  /**
   * 模拟历史 int：数字截断，整数字符串可转，布尔值按 1/0
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
   * JSON record 收窄集中处理，保护数组和 null 不进入业务判断
   */
  private is_record(value: unknown): value is JsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  /**
   * 统一 start 请求收窄为 Engine 命令，revision 依赖只由命令语义决定
   */
  private normalize_start_command(request: JsonRecord): StartTaskCommand {
    const task_type = this.require_task_type(request["task_type"]);
    const mode = this.normalize_mode(request["mode"]);
    const expected_section_revisions = this.normalize_expected_section_revisions(
      request["expected_section_revisions"],
    );
    if (task_type === "analysis") {
      const command: StartTaskCommand = {
        task_type,
        mode,
        expected_section_revisions: expected_section_revisions ?? {},
      };
      const definition = this.task_definition_registry.get(command);
      this.assert_expected_section_revisions(
        expected_section_revisions,
        definition.revision_dependencies(command),
      );
      return definition.normalize_command(command);
    }
    const scope = this.normalize_translation_scope(request);
    const command: StartTaskCommand = {
      task_type,
      mode,
      scope,
      expected_section_revisions: expected_section_revisions ?? {},
    };
    const definition = this.task_definition_registry.get(command);
    if (scope.kind === "items") {
      this.require_loaded_project_path();
    }
    this.assert_expected_section_revisions(
      expected_section_revisions,
      definition.revision_dependencies(command),
    );
    return definition.normalize_command(command);
  }

  /**
   * stop 请求只允许指定现有 TaskType，重翻停止也归入 translation
   */
  private normalize_stop_command(request: JsonRecord): StopTaskCommand {
    return { task_type: this.require_task_type(request["task_type"]) };
  }

  /**
   * task_type 是公开命令分发根，不能接受 retranslate 作为任务类型
   */
  private require_task_type(value: ApiJsonValue | undefined): TaskType {
    if (is_task_type(value)) {
      return value;
    }
    throw new Error(`任务类型无效：${String(value)}`);
  }

  /**
   * mode 在公开边界兼收大小写输入，进入 Engine 后固定为小写枚举
   */
  private normalize_mode(value: ApiJsonValue | undefined): TaskStartMode {
    const mode = String(value ?? "new").toLowerCase();
    if (!is_task_start_mode(mode)) {
      throw new Error(`任务模式无效：${String(value)}`);
    }
    return mode;
  }

  /**
   * scope 是普通翻译与重翻的唯一语义源；items scope 必须携带非空 item_ids
   */
  private normalize_translation_scope(request: JsonRecord): TranslationScope {
    const scope = this.is_record(request["scope"]) ? request["scope"] : {};
    const scope_kind = String(scope["kind"] ?? "all");
    if (scope_kind === "all") {
      return { kind: "all" };
    }
    if (scope_kind !== "items") {
      throw new Error(`翻译任务范围无效：${scope_kind}`);
    }
    const item_ids = this.normalize_item_ids(scope["item_ids"] ?? request["item_ids"]);
    if (item_ids.length === 0) {
      throw new Error("请选择要重新翻译的条目。");
    }
    return { kind: "items", item_ids };
  }
}
