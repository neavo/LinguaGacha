import type { ProjectSessionState } from "../project/project-session-state";
import type { TaskEngine } from "./core/engine";
import type { StartTaskCommand, StopTaskCommand } from "./protocol/task-command";
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

  private readonly session_state: ProjectSessionState; // 任务启动前只负责确认当前工程已加载

  /**
   * 注入任务命令依赖，保持公开协议、运行态桥和工程会话边界可测试
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
   * 启动任务；公开层只收窄任务意图，运行 lease 是唯一并发受理边界
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
   * 当前工程入口复用同一启动流程，供 CLI 等同进程调用方使用。
   */
  public async start_current_project_task(command: StartTaskCommand): Promise<TaskSnapshot> {
    return await this.start_command(command);
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
        throw new AggregateError(
          [error, restore_error],
          "Task startup and recovery snapshot publication both failed.",
        );
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
    if (Object.hasOwn(request, "expected_section_revisions")) {
      throw new AppErrors.AppError("request.validation_failed", {
        diagnostic_context: { reason: "task_start_legacy_revision_field" },
      });
    }
    const task_type = this.require_task_type(request["task_type"]);
    const mode = this.normalize_mode(request["mode"]);
    if (task_type === "analysis") {
      return { task_type, mode };
    }
    const scope = this.normalize_translation_scope(request);
    return { task_type, mode, scope };
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
    throw new AppErrors.AppError("request.validation_failed");
  }

  /**
   * mode 在公开边界兼收大小写输入，进入 Engine 后固定为小写枚举
   */
  private normalize_mode(value: JsonValue | undefined): TaskStartMode {
    const mode = String(value ?? "new").toLowerCase();
    if (!is_task_start_mode(mode)) {
      throw new AppErrors.AppError("request.validation_failed");
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
      throw new AppErrors.AppError("request.validation_failed");
    }
    const item_ids = this.normalize_item_ids(scope["item_ids"] ?? request["item_ids"]);
    if (item_ids.length === 0) {
      throw new AppErrors.AppError("request.validation_failed");
    }
    return { kind: "items", item_ids };
  }
}
