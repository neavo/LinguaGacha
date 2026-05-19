import type { ApiJsonValue } from "../../api/api-types";
import { ProjectDatabase } from "../../database/database-operations";
import { ProjectRuntimeProjectionService } from "../../project/project-runtime-projection-service";
import { ProjectSessionState } from "../../project/project-session-state";
import { TaskRuntimeState } from "./task-runtime-state";
import {
  is_task_type,
  type JsonRecord,
  type MutableJsonRecord,
  type TaskRuntimeStatePayload,
  type TaskType,
} from "./task-runtime-types";
import type { TaskProgress, TaskSnapshot } from "../protocol/task-snapshot";

// 任务进度数值字段按 TaskSnapshotPayload 固定，缺失时逐项补齐零值
const TASK_PROGRESS_NUMBER_FIELDS = [
  "line",
  "total_line",
  "processed_line",
  "error_line",
  "total_tokens",
  "total_output_tokens",
  "total_input_tokens",
] as const;

const TASK_PROGRESS_FLOAT_FIELDS = ["time", "start_time"] as const; // 时间字段保留浮点值，避免任务耗时在序列化后被截断

/**
 * 在 API Gateway 内构建公开任务快照，进度读 `.lg`，实时状态读 `TaskRuntimeState`
 */
export class TaskSnapshotBuilder {
  private readonly task_runtime_state: TaskRuntimeState; // task_runtime_state 是实时 busy / 请求中数量的唯一读源

  private readonly session_state: ProjectSessionState; // session_state 决定当前公开工程路径

  private readonly projection_service: ProjectRuntimeProjectionService; // projection_service 只负责 meta/revision 读取，快照热路径不扫大 section

  /**
   * 注入公开快照所需的三个权威来源，便于 Gateway 和任务命令共用同一口径
   */
  public constructor(
    database: ProjectDatabase,
    task_runtime_state: TaskRuntimeState,
    session_state: ProjectSessionState,
    projection_service = new ProjectRuntimeProjectionService(database),
  ) {
    this.task_runtime_state = task_runtime_state;
    this.session_state = session_state;
    this.projection_service = projection_service;
  }

  /**
   * 按请求体选择任务类型；缺失或非法时根据 Engine 与持久进度推导当前任务
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
   * 真实组装任务快照，保证普通查询和命令 ack 使用同一字段集
   */
  private build_task_snapshot_from_state(
    task_type: TaskType,
    engine_state: TaskRuntimeStatePayload,
    meta: JsonRecord,
  ): MutableJsonRecord {
    const progress =
      task_type === "analysis"
        ? this.build_analysis_progress_snapshot(meta)
        : this.normalize_progress_snapshot(this.normalize_object(meta["translation_extras"]));
    const snapshot: TaskSnapshot = {
      runtime_revision: engine_state.runtime_revision,
      task_type,
      status: engine_state.status,
      busy: engine_state.busy,
      request_in_flight_count: engine_state.request_in_flight_count,
      progress: progress as TaskProgress,
      extras:
        task_type === "analysis"
          ? {
              kind: "analysis",
              candidate_count: this.read_number(meta["analysis_candidate_count"], 0),
            }
          : {
              kind: "translation",
              scope: engine_state.translation_scope,
            },
    };
    return snapshot as unknown as MutableJsonRecord;
  }

  /**
   * 任务类型优先跟随 Engine；Engine 空闲时再用持久进度选择最相关页面
   */
  private resolve_task_type(engine_state: TaskRuntimeStatePayload, meta: JsonRecord): TaskType {
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
   * 分析快照只读取已提交进度 extras，运行中不再为高频 snapshot 扫描 items/checkpoint。
   */
  private build_analysis_progress_snapshot(meta: JsonRecord): MutableJsonRecord {
    return this.normalize_progress_snapshot(this.normalize_object(meta["analysis_extras"]));
  }

  /**
   * 当前工程未加载时不触碰数据库，直接返回空 meta
   */
  private get_loaded_project_meta(): MutableJsonRecord {
    const state = this.session_state.snapshot();
    if (!state.loaded || state.projectPath === "") {
      return {};
    }
    return this.projection_service.get_all_meta(state.projectPath);
  }

  /**
   * 进度字段坏值归零，额外字段继续透传给前端兼容窗口
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
   * 重翻 revision 校验与快照构建共享 section revision 读取口径
   */
  public get_runtime_section_revision(section: string): number {
    return this.projection_service.get_runtime_section_revision(
      this.get_loaded_project_meta(),
      section,
    );
  }

  /**
   * 普通对象才允许作为 JSON record 继续下钻
   */
  private normalize_object(value: ApiJsonValue | undefined): MutableJsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value } : {};
  }

  /**
   * 数字进度使用整数转换语义
   */
  private read_number(value: ApiJsonValue | undefined, fallback: number): number {
    const number_value = Number(value ?? fallback);
    return Number.isFinite(number_value) ? Math.trunc(number_value) : fallback;
  }

  /**
   * 时间进度保留小数，避免耗时显示抖动
   */
  private read_float(value: ApiJsonValue | undefined, fallback: number): number {
    const number_value = Number(value ?? fallback);
    return Number.isFinite(number_value) ? number_value : fallback;
  }
}
