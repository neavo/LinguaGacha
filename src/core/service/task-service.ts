import type { ApiJsonValue } from "../api/api-types";
import { AppSettingService } from "../app/app-setting-service";
import { resolve_active_model } from "../model/model-config-resolver";
import type { ProjectOperationGate } from "../project/project-operation-gate";
import { ProjectSessionState } from "../project/project-session-state";
import { normalize_project_expected_section_revisions } from "../project/project-mutation-coordinator";
import { TaskEngine } from "../engine/core/engine";
import { TaskRuntimePublisher } from "../engine/runtime/task-runtime-publisher";
import { TaskSnapshotBuilder } from "../engine/runtime/task-snapshot-builder";
import { type JsonRecord, type MutableJsonRecord } from "../engine/runtime/task-runtime-types";
import type { StartTaskCommand, StopTaskCommand } from "../engine/protocol/task-command";
import { AnalysisTaskDefinition } from "../engine/definitions/analysis/analysis-task-definition";
import { TaskDefinitionRegistry } from "../engine/definitions/registry";
import { TranslationTaskDefinition } from "../engine/definitions/translation/translation-task-definition";
import * as AppErrors from "../../shared/error";
import {
  is_task_start_mode,
  is_task_type,
  type TaskStartMode,
  type TaskType,
  type TranslationScope,
} from "../../domain/task";

/**
 * 公开 `/api/tasks/*` 的任务服务，负责校验命令、调用 TaskEngine 并组装回执
 */
export class TaskService {
  private readonly task_engine: TaskEngine; // task_engine 是后台任务生命周期、调度和停止的唯一执行权威

  private readonly snapshot_builder: TaskSnapshotBuilder; // snapshot_builder 是公开任务快照唯一组装口径，启动回执也复用它

  private readonly task_runtime_publisher: TaskRuntimePublisher; // task_runtime_publisher 是启动乐观态与失败回滚的唯一出口

  private readonly project_operation_gate: ProjectOperationGate; // project_operation_gate 统一判断任务启动是否会撞上 busy 或结构性 mutation

  private readonly session_state: ProjectSessionState; // session_state 决定重翻 revision 校验是否能定位当前工程

  private readonly app_setting_service: AppSettingService; // app_setting_service 只用于单条翻译前的主动模型可用性检查

  private readonly task_definition_registry = new TaskDefinitionRegistry(); // task_definition_registry 是任务类型差异和 revision 依赖的唯一注册表

  /**
   * 注入任务命令依赖，保持公开协议、运行态桥和配置读取边界可测试
   */
  public constructor(
    task_engine: TaskEngine,
    snapshot_builder: TaskSnapshotBuilder,
    task_runtime_publisher: TaskRuntimePublisher,
    project_operation_gate: ProjectOperationGate,
    session_state: ProjectSessionState,
    app_setting_service: AppSettingService,
  ) {
    this.task_engine = task_engine;
    this.snapshot_builder = snapshot_builder;
    this.task_runtime_publisher = task_runtime_publisher;
    this.project_operation_gate = project_operation_gate;
    this.session_state = session_state;
    this.app_setting_service = app_setting_service;
    this.task_definition_registry.register(new TranslationTaskDefinition());
    this.task_definition_registry.register(new AnalysisTaskDefinition());
  }

  /**
   * 启动任务；公开层只做 JSON 收窄、revision 校验、模型检查和 Engine 命令转交
   */
  public async start_task(request: JsonRecord): Promise<MutableJsonRecord> {
    const command = this.normalize_start_command(request);
    const previous_state = this.task_runtime_publisher.snapshot_state();
    // assert_task_start_allowed 与 begin_task 之间不能插入 await，保证通过 gate 后立即写入 busy。
    this.project_operation_gate.assert_task_start_allowed();
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
      task: (await this.snapshot_builder.build_task_snapshot({
        task_type: command.task_type,
      })) as unknown as ApiJsonValue,
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
      throw new AppErrors.RequestValidationError();
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
      throw new AppErrors.ProjectNotLoadedError();
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
      throw new AppErrors.RequestValidationError();
    }
    for (const section of sections) {
      if (!(section in expected)) {
        throw new AppErrors.RequestValidationError({
          public_details: { section },
        });
      }
      this.assert_expected_revision(
        section,
        expected,
        this.snapshot_builder.get_runtime_section_revision(section),
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
  ): void {
    const expected_revision = expected[section] ?? 0;
    if (current_revision !== expected_revision) {
      throw new AppErrors.RevisionConflictError({
        public_details: {
          current_revision,
          expected_revision,
          section,
        },
      });
    }
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
   * expected_section_revisions 必须是对象；锁值只接受 JSON number 整数
   */
  private normalize_expected_section_revisions(
    value: ApiJsonValue | undefined,
  ): Record<string, number> | null {
    return normalize_project_expected_section_revisions(value);
  }

  /**
   * 单条翻译只做基础模型存在性判断；真实请求能力由 work-unit executor 负责
   */
  private has_active_model(): boolean {
    const config = this.app_setting_service.read_setting();
    return resolve_active_model(config) !== null;
  }

  /**
   * item_id 只接受整数数字或整数字符串，拒绝布尔值和小数兼容
   */
  private parse_integer_like(value: ApiJsonValue | undefined): number | null {
    if (typeof value === "number") {
      return Number.isInteger(value) ? value : null;
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
    throw new AppErrors.RequestValidationError();
  }

  /**
   * mode 在公开边界兼收大小写输入，进入 Engine 后固定为小写枚举
   */
  private normalize_mode(value: ApiJsonValue | undefined): TaskStartMode {
    const mode = String(value ?? "new").toLowerCase();
    if (!is_task_start_mode(mode)) {
      throw new AppErrors.RequestValidationError();
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
      throw new AppErrors.RequestValidationError();
    }
    const item_ids = this.normalize_item_ids(scope["item_ids"] ?? request["item_ids"]);
    if (item_ids.length === 0) {
      throw new AppErrors.RequestValidationError();
    }
    return { kind: "items", item_ids };
  }
}
