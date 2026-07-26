import { is_active_analysis_task_status } from "../../domain/task";
import {
  create_empty_workbench_task_snapshot,
  has_workbench_task_progress,
  normalize_workbench_task_snapshot_payload,
  resolve_workbench_task_display_snapshot,
  resolve_workbench_task_metrics,
  type WorkbenchTaskMetrics,
  type WorkbenchTaskSnapshot,
  type WorkbenchTaskSnapshotPayload,
} from "./task-model";

export { is_active_analysis_task_status };

export type AnalysisTaskActionKind =
  | "reset-all"
  | "reset-failed"
  | "import-glossary"
  | "stop-analysis";

export type AnalysisTaskSnapshot = WorkbenchTaskSnapshot & {
  candidate_count: number;
};

export type AnalysisTaskPayload = {
  task?: WorkbenchTaskSnapshotPayload & {
    candidate_count?: number;
    extras?: { kind?: string; candidate_count?: number };
  };
  imported_count?: number;
};

export type AnalysisTaskConfirmState = {
  kind: AnalysisTaskActionKind;
  open: boolean;
  submitting: boolean;
};

export type AnalysisTaskMetrics = WorkbenchTaskMetrics & {
  candidate_count: number;
};

// 分析任务只在共享运行态上追加候选术语计数。
export function create_empty_analysis_task_snapshot(): AnalysisTaskSnapshot {
  return {
    ...create_empty_workbench_task_snapshot("analysis"),
    candidate_count: 0,
  };
}

// 当前快照只有标量字段，浅复制即可隔离调用方写入。
export function clone_analysis_task_snapshot(snapshot: AnalysisTaskSnapshot): AnalysisTaskSnapshot {
  return { ...snapshot };
}

// candidate_count 属于分析 extras，不混入通用 progress 载荷。
export function normalize_analysis_task_snapshot_payload(
  payload: AnalysisTaskPayload,
): AnalysisTaskSnapshot {
  const snapshot = payload.task ?? {};
  return {
    ...normalize_workbench_task_snapshot_payload(snapshot, "analysis"),
    candidate_count: Number(snapshot.extras?.candidate_count ?? 0),
  };
}

// 分析进度沿用工作台公共运行态口径。
export function has_analysis_task_progress(snapshot: AnalysisTaskSnapshot | null): boolean {
  return has_workbench_task_progress(snapshot);
}

// 即使行进度为空，待导入候选也必须保留终态展示。
export function has_analysis_task_display_state(snapshot: AnalysisTaskSnapshot | null): boolean {
  return has_analysis_task_progress(snapshot) || (snapshot?.candidate_count ?? 0) > 0;
}

// 分析任务用候选展示口径选择当前或历史终态。
export function resolve_analysis_task_display_snapshot(args: {
  current_snapshot: AnalysisTaskSnapshot;
  last_snapshot: AnalysisTaskSnapshot | null;
}): AnalysisTaskSnapshot | null {
  return resolve_workbench_task_display_snapshot({
    ...args,
    is_active: is_active_analysis_task_status,
    has_display_state: has_analysis_task_display_state,
  });
}

// 公共指标之外仅补充非负候选计数。
export function resolve_analysis_task_metrics(args: {
  snapshot: AnalysisTaskSnapshot | null;
  now_seconds: number;
}): AnalysisTaskMetrics {
  return {
    ...resolve_workbench_task_metrics({
      ...args,
      active: args.snapshot !== null && is_active_analysis_task_status(args.snapshot.status),
    }),
    candidate_count: Math.max(0, args.snapshot?.candidate_count ?? 0),
  };
}
