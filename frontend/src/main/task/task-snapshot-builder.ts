import type { ApiJsonValue } from "../api/api-types";
import { ProjectDatabase } from "../database/database-operations";
import type { DatabaseJsonValue, DatabaseOperation } from "../database/database-types";
import { get_runtime_section_revision } from "../project/project-section-revision";
import { ProjectSessionState } from "../project/project-session-state";
import { TaskRuntimeState } from "./task-runtime-state";
import {
  is_task_type,
  type JsonRecord,
  type MutableJsonRecord,
  type TaskEngineStatePayload,
  type TaskType,
} from "./task-types";

// 任务进度数值字段由旧 Python TaskSnapshotPayload 固定，迁移后继续逐项补齐零值。
const TASK_PROGRESS_NUMBER_FIELDS = [
  "line",
  "total_line",
  "processed_line",
  "error_line",
  "total_tokens",
  "total_output_tokens",
  "total_input_tokens",
] as const;

// 时间字段保留浮点值，避免任务耗时在跨语言迁移时被截断。
const TASK_PROGRESS_FLOAT_FIELDS = ["time", "start_time"] as const;

// 分析摘要只统计当前仍可分析的条目状态。
const ANALYSIS_CHECKPOINT_STATUSES = new Set(["NONE", "PROCESSED", "ERROR"]);
const ANALYSIS_SKIPPED_STATUSES = new Set([
  "EXCLUDED",
  "RULE_SKIPPED",
  "LANGUAGE_SKIPPED",
  "DUPLICATED",
]);

/**
 * 在 TS Gateway 内构建公开任务快照，进度读 `.lg`，实时状态读 TS runtime state。
 */
export class TaskSnapshotBuilder {
  // database 是持久任务进度的唯一读源，不能改为 Python DataManager 快照。
  private readonly database: ProjectDatabase;

  // task_runtime_state 是实时 busy / 请求中数量的唯一读源，不再反查 Python。
  private readonly task_runtime_state: TaskRuntimeState;

  // session_state 决定当前公开工程路径，避免从 Python 会话反推 loaded/path。
  private readonly session_state: ProjectSessionState;

  /**
   * 注入公开快照所需的三个权威来源，便于 Gateway 和 bootstrap 共用同一口径。
   */
  public constructor(
    database: ProjectDatabase,
    task_runtime_state: TaskRuntimeState,
    session_state: ProjectSessionState,
  ) {
    this.database = database;
    this.task_runtime_state = task_runtime_state;
    this.session_state = session_state;
  }

  /**
   * 按请求体选择任务类型；缺失或非法时根据 Engine 与持久进度推导当前任务。
   */
  public async build_task_snapshot(request: JsonRecord = {}): Promise<MutableJsonRecord> {
    const engine_state = this.task_runtime_state.snapshot();
    const meta = this.get_loaded_project_meta();
    const requested_task_type = String(request["task_type"] ?? "");
    const task_type = is_task_type(requested_task_type)
      ? requested_task_type
      : this.resolve_task_type(engine_state, meta);
    return this.build_task_snapshot_from_state(task_type, engine_state, meta);
  }

  /**
   * 命令回执要立即覆盖用户操作意图，不能等下一帧 SSE 才改变按钮态。
   */
  public async build_command_ack(
    task_type: TaskType,
    status: string,
    busy: boolean,
    overrides: JsonRecord = {},
  ): Promise<MutableJsonRecord> {
    const snapshot = this.build_task_snapshot_from_state(
      task_type,
      this.task_runtime_state.snapshot(),
      this.get_loaded_project_meta(),
    );
    return {
      ...snapshot,
      ...overrides,
      busy,
      status,
      task_type,
    };
  }

  /**
   * 真实组装任务快照，保证普通查询、命令 ack 和 bootstrap 使用同一字段集。
   */
  private build_task_snapshot_from_state(
    task_type: TaskType,
    engine_state: TaskEngineStatePayload,
    meta: JsonRecord,
  ): MutableJsonRecord {
    const progress =
      task_type === "analysis"
        ? this.build_analysis_progress_snapshot(meta)
        : this.normalize_progress_snapshot(this.normalize_object(meta["translation_extras"]));
    const snapshot: MutableJsonRecord = {
      task_type,
      status: engine_state.status,
      busy: engine_state.busy,
      request_in_flight_count: engine_state.request_in_flight_count,
      ...progress,
    };
    if (task_type === "analysis") {
      snapshot["analysis_candidate_count"] = this.read_number(meta["analysis_candidate_count"], 0);
    }
    if (task_type === "retranslate") {
      snapshot["retranslating_item_ids"] =
        engine_state.retranslating_item_ids as unknown as ApiJsonValue;
    }
    return snapshot;
  }

  /**
   * 任务类型优先跟随 Engine；Engine 空闲时再用持久进度选择最相关页面。
   */
  private resolve_task_type(engine_state: TaskEngineStatePayload, meta: JsonRecord): TaskType {
    if (is_task_type(engine_state.active_task_type)) {
      return engine_state.active_task_type;
    }
    const translation_progress = this.normalize_progress_snapshot(
      this.normalize_object(meta["translation_extras"]),
    );
    if (this.read_number(translation_progress["line"], 0) > 0) {
      return "translation";
    }
    const analysis_progress = this.build_analysis_progress_snapshot(meta);
    if (this.read_number(analysis_progress["line"], 0) > 0) {
      return "analysis";
    }
    return "translation";
  }

  /**
   * 分析快照把持久 extras 与当前 checkpoint 覆盖率合并，等价旧 DataManager 读口径。
   */
  private build_analysis_progress_snapshot(meta: JsonRecord): MutableJsonRecord {
    return this.normalize_progress_snapshot({
      ...this.normalize_object(meta["analysis_extras"]),
      ...this.build_analysis_status_summary(),
    });
  }

  /**
   * 当前工程未加载时不触碰数据库，直接返回空 meta。
   */
  private get_loaded_project_meta(): MutableJsonRecord {
    const state = this.session_state.snapshot();
    if (!state.loaded || state.projectPath === "") {
      return {};
    }
    return this.normalize_object(
      this.database.execute(this.op("getAllMeta", { projectPath: state.projectPath })),
    );
  }

  /**
   * 分析覆盖率只依赖当前 `.lg` 中的 items 与 checkpoint，避免 Python 缓存决定公开快照。
   */
  private build_analysis_status_summary(): MutableJsonRecord {
    const state = this.session_state.snapshot();
    if (!state.loaded || state.projectPath === "") {
      return { total_line: 0, processed_line: 0, error_line: 0, line: 0 };
    }
    const checkpoints = this.get_analysis_checkpoints(state.projectPath);
    let total_line = 0;
    let processed_line = 0;
    let error_line = 0;
    for (const item of this.get_all_items(state.projectPath)) {
      const status = this.normalize_item_status(item["status"]);
      if (ANALYSIS_SKIPPED_STATUSES.has(status)) {
        continue;
      }
      const item_id = this.read_number(item["id"], 0);
      if (item_id <= 0 || String(item["src"] ?? "").trim() === "") {
        continue;
      }
      total_line += 1;
      const checkpoint_status = checkpoints.get(item_id) ?? "NONE";
      if (checkpoint_status === "PROCESSED") {
        processed_line += 1;
      } else if (checkpoint_status === "ERROR") {
        error_line += 1;
      }
    }
    return {
      total_line,
      processed_line,
      error_line,
      line: processed_line + error_line,
    };
  }

  /**
   * 进度字段坏值按旧 TaskSnapshotPayload 归零，额外字段继续透传给前端兼容窗口。
   */
  private normalize_progress_snapshot(raw_snapshot: JsonRecord): MutableJsonRecord {
    const snapshot: MutableJsonRecord = { ...raw_snapshot };
    for (const field of TASK_PROGRESS_NUMBER_FIELDS) {
      snapshot[field] = this.read_number(raw_snapshot[field], 0);
    }
    for (const field of TASK_PROGRESS_FLOAT_FIELDS) {
      snapshot[field] = this.read_float(raw_snapshot[field], 0);
    }
    return snapshot;
  }

  /**
   * 重翻 revision 校验与快照构建共享 section revision 读取口径。
   */
  public get_runtime_section_revision(section: string): number {
    return get_runtime_section_revision(this.get_loaded_project_meta(), section);
  }

  /**
   * 读取全部 item 仍只通过 ProjectDatabase workflow，保持 SQL 落点集中。
   */
  private get_all_items(project_path: string): MutableJsonRecord[] {
    const value = this.database.execute(this.op("getAllItems", { projectPath: project_path }));
    return Array.isArray(value)
      ? value
          .filter((item): item is JsonRecord => this.is_record(item))
          .map((item) => ({ ...item }))
      : [];
  }

  /**
   * checkpoint 以 item_id 建索引，分析进度只需要三态覆盖事实。
   */
  private get_analysis_checkpoints(project_path: string): Map<number, string> {
    const value = this.database.execute(
      this.op("getAnalysisItemCheckpoints", { projectPath: project_path }),
    );
    const checkpoints = new Map<number, string>();
    if (!Array.isArray(value)) {
      return checkpoints;
    }
    for (const row of value) {
      if (!this.is_record(row)) {
        continue;
      }
      const item_id = this.read_number(row["item_id"], 0);
      const status = String(row["status"] ?? "");
      if (item_id > 0 && ANALYSIS_CHECKPOINT_STATUSES.has(status)) {
        checkpoints.set(item_id, status);
      }
    }
    return checkpoints;
  }

  /**
   * 历史处理中状态在任务进度统计里归一为当前可消费状态。
   */
  private normalize_item_status(value: ApiJsonValue | undefined): string {
    const status = String(value ?? "NONE");
    if (status === "PROCESSED_IN_PAST") {
      return "PROCESSED";
    }
    if (status === "PROCESSING") {
      return "NONE";
    }
    return status;
  }

  /**
   * 普通对象才允许作为 JSON record 继续下钻。
   */
  private normalize_object(value: ApiJsonValue | undefined): MutableJsonRecord {
    return this.is_record(value) ? { ...value } : {};
  }

  /**
   * 数字进度使用整数，兼容旧 Python int 转换语义。
   */
  private read_number(value: ApiJsonValue | undefined, fallback: number): number {
    const number_value = Number(value ?? fallback);
    return Number.isFinite(number_value) ? Math.trunc(number_value) : fallback;
  }

  /**
   * 时间进度保留小数，避免耗时显示在迁移后抖动。
   */
  private read_float(value: ApiJsonValue | undefined, fallback: number): number {
    const number_value = Number(value ?? fallback);
    return Number.isFinite(number_value) ? number_value : fallback;
  }

  /**
   * 类型收窄集中在一个入口，减少 builder 内部重复判断。
   */
  private is_record(value: unknown): value is JsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  /**
   * database operation 在任务层统一创建，避免操作名和参数形状散落。
   */
  private op(name: string, args: Record<string, DatabaseJsonValue>): DatabaseOperation {
    return { name, args };
  }
}
