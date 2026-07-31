import type { ProjectSessionState } from "../project/project-session-state";
import { normalize_project_expected_section_revisions } from "../project/project-write-request";
import type { TaskEngine } from "./core/engine";
import type {
  CurrentProjectTaskStartCommand,
  StartTaskCommand,
  StopTaskCommand,
} from "./protocol/task-command";
import type { TaskSnapshot, TaskSnapshotListener } from "./protocol/task-snapshot";
import type { TaskRuntime } from "./task-runtime";
import * as AppErrors from "../../shared/error";
import {
  is_json_record,
  type JsonRecord,
  type JsonValue,
  type MutableJsonRecord,
} from "../../domain/json";
import {
  is_task_start_mode,
  is_task_type,
  type TaskStartMode,
  type TaskType,
  type TranslationScope,
} from "../../domain/task";

/**
 * 任务命令服务，统一承接 HTTP 与同进程入口并调用 TaskEngine。
 */
export class TaskService {
  private readonly task_engine: TaskEngine; // 后台任务生命周期、调度和停止的唯一执行权威

  private readonly task_runtime: TaskRuntime; // 任务锁、快照、取消和失败恢复的唯一所有者

  private readonly session_state: ProjectSessionState; // 决定重翻 revision 校验是否能定位当前工程

  /**
   * 注入任务命令依赖，保持公开协议、运行态桥和配置读取边界可测试
   */
  public constructor(
    task_engine: TaskEngine,
    task_runtime: TaskRuntime,
    session_state: ProjectSessionState,
  ) {
    this.task_engine = task_engine;
    this.task_runtime = task_runtime;
    this.session_state = session_state;
  }

  /**
   * 同进程消费者通过 TaskService 订阅快照，不直接持有 TaskRuntime。
   */
  public subscribe(listener: TaskSnapshotListener): () => void {
    return this.task_runtime.subscribe(listener);
  }

  /**
   * 启动任务；公开层只做 JSON 收窄、revision 校验、模型检查和 Engine 命令转交
   */
  public async start_task(request: JsonRecord): Promise<MutableJsonRecord> {
    const command = this.normalize_start_command(request);
    const snapshot = await this.start_command(command);
    return {
      accepted: true,
      task: snapshot as unknown as JsonValue,
    };
  }

  /**
   * 当前工程入口读取最新 revision 后复用同一启动流程，供 CLI 等同进程调用方使用。
   */
  public async start_current_project_task(
    command: CurrentProjectTaskStartCommand,
  ): Promise<TaskSnapshot> {
    const sections = this.resolve_required_sections(
      command.task_type,
      command.task_type === "translation" ? command.scope : { kind: "all" },
    );
    const expected_section_revisions = Object.fromEntries(
      sections.map((section) => [section, this.task_runtime.get_section_revision(section)]),
    );
    const start_command: StartTaskCommand = {
      ...command,
      expected_section_revisions,
    };
    return await this.start_command(start_command);
  }

  /**
   * HTTP 与同进程入口汇入这里后共享门禁、预约、失败恢复和真实回包快照。
   */
  private async start_command(command: StartTaskCommand): Promise<TaskSnapshot> {
    this.session_state.require_loaded_project_path();
    const handle = await this.task_runtime.begin(
      command.task_type,
      command.task_type === "translation" ? command.scope : { kind: "all" },
    );
    try {
      await this.task_engine.start(handle, command);
    } catch (error) {
      try {
        await this.task_runtime.cancel_start(handle);
      } catch (restore_error) {
        throw new AggregateError([error, restore_error], "任务启动失败且恢复快照发布失败");
      }
      throw error;
    }
    return await this.task_runtime.build_snapshot({
      task_type: command.task_type,
    });
  }

  /**
   * 停止任务；回包必须读取当前真实 snapshot，避免 HTTP 晚于终态 SSE 时回写旧 stopping
   */
  public async stop_task(request: JsonRecord): Promise<MutableJsonRecord> {
    const command = this.normalize_stop_command(request);
    const accepted = await this.task_engine.stop(command);
    return {
      accepted,
      task: (await this.task_runtime.build_snapshot(
        accepted ? { task_type: command.task_type } : {},
      )) as unknown as JsonValue,
    };
  }

  /**
   * 显式读取任务快照；它是按需查询，不承担订阅职责
   */
  public async get_task_snapshot(request: JsonRecord): Promise<MutableJsonRecord> {
    return {
      task: (await this.task_runtime.build_snapshot(request)) as unknown as JsonValue,
    };
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
        this.task_runtime.get_section_revision(section),
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
  private normalize_item_ids(value: JsonValue | undefined): number[] {
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
    value: JsonValue | undefined,
  ): Record<string, number> | null {
    return normalize_project_expected_section_revisions(value);
  }

  /**
   * item_id 只接受整数数字或整数字符串，拒绝布尔值和小数兼容
   */
  private parse_integer_like(value: JsonValue | undefined): number | null {
    if (typeof value === "number") {
      return Number.isInteger(value) ? value : null;
    }
    if (typeof value === "string" && /^[+-]?\d+$/.test(value.trim())) {
      return Number.parseInt(value, 10);
    }
    return null;
  }

  /**
   * 统一 start 请求收窄为 Engine 命令
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
      this.assert_expected_section_revisions(
        expected_section_revisions,
        this.resolve_required_sections(task_type, { kind: "all" }),
      );
      return command;
    }
    const scope = this.normalize_translation_scope(request);
    const command: StartTaskCommand = {
      task_type,
      mode,
      scope,
      expected_section_revisions: expected_section_revisions ?? {},
    };
    this.assert_expected_section_revisions(
      expected_section_revisions,
      this.resolve_required_sections(task_type, scope),
    );
    return command;
  }

  /**
   * 两类启动入口共用 section 依赖集合，避免 CLI 绕过新增的输入事实。
   */
  private resolve_required_sections(task_type: TaskType, scope: TranslationScope): string[] {
    if (task_type === "translation" && scope.kind === "items") {
      this.session_state.require_loaded_project_path();
      return ["items", "proofreading", "quality", "prompts"];
    }
    return ["quality", "prompts"];
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
  private require_task_type(value: JsonValue | undefined): TaskType {
    if (is_task_type(value)) {
      return value;
    }
    throw new AppErrors.RequestValidationError();
  }

  /**
   * mode 在公开边界兼收大小写输入，进入 Engine 后固定为小写枚举
   */
  private normalize_mode(value: JsonValue | undefined): TaskStartMode {
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
    const scope = is_json_record(request["scope"]) ? request["scope"] : {};
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
