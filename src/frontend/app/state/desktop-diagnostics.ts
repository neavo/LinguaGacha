import type { DesktopRefreshSchedulerErrorContext } from "@frontend/app/state/desktop-refresh-scheduler";
import type { TaskSnapshot } from "@frontend/app/state/task-snapshot-store";
import {
  normalize_section_array,
  normalize_section_revisions,
} from "@frontend/app/state/desktop-event-payload";
import type { ProjectChangeEventForState } from "@frontend/app/state/desktop-project-change-types";
import {
  summarize_log_error_path,
  type LogErrorPathIdentity,
  type LogErrorContext,
} from "@shared/error";

type RuntimeProjectDiagnosticsInput = {
  loaded: boolean;
  path: string;
  sessionStatus: string;
};

type ProjectChangePayloadDiagnosticsInput = {
  eventId?: unknown;
  source?: unknown;
  projectPath?: unknown;
  projectRevision?: unknown;
  updatedSections?: unknown;
  sectionRevisions?: unknown;
};

/**
 * 项目诊断只保留运行态身份和 session 阶段，避免把大 section 写入异常日志。
 */
export function summarize_project_state_for_diagnostics(
  input: RuntimeProjectDiagnosticsInput,
): LogErrorContext {
  return {
    loaded: input.loaded,
    path: summarize_path_for_diagnostics(input.path),
    sessionStatus: input.sessionStatus,
  };
}

/**
 * task 诊断只取状态和进度数字，避免把页面展示 extras 写入异常日志。
 */
export function summarize_task_snapshot_for_diagnostics(snapshot: TaskSnapshot): LogErrorContext {
  return {
    runRevision: snapshot.run_revision,
    taskType: snapshot.task_type,
    status: snapshot.status,
    busy: snapshot.busy,
    requestInFlightCount: snapshot.request_in_flight_count,
    progress: {
      line: snapshot.progress.line,
      totalLine: snapshot.progress.total_line,
      processedLine: snapshot.progress.processed_line,
      errorLine: snapshot.progress.error_line,
    },
  };
}

/**
 * 项目事件诊断只记录事件头和 operation 数量，不记录可能很大的 items/files payload。
 */
export function summarize_project_change_for_diagnostics(
  event: ProjectChangeEventForState,
): LogErrorContext {
  return {
    eventId: event.eventId ?? "",
    source: event.source,
    projectPath: summarize_path_for_diagnostics(event.projectPath),
    projectRevision: event.projectRevision,
    updatedSections: event.updatedSections,
    sectionRevisions: event.sectionRevisions ?? {},
    operationCount: event.operations.length,
  };
}

/**
 * 原始 SSE payload 归一成轻量摘要，供规范化失败时仍能定位触发事件。
 */
export function summarize_project_change_payload_for_diagnostics(
  payload: ProjectChangePayloadDiagnosticsInput,
): LogErrorContext {
  return {
    eventId: String(payload.eventId ?? ""),
    source: String(payload.source ?? ""),
    projectPath: summarize_path_for_diagnostics(String(payload.projectPath ?? "")),
    projectRevision: Number(payload.projectRevision ?? 0),
    updatedSections: normalize_section_array(payload.updatedSections),
    sectionRevisions: normalize_section_revisions(payload.sectionRevisions) ?? {},
  };
}

/**
 * 路径诊断只保留文件名和稳定 hash，避免日志中出现用户完整目录结构。
 */
function summarize_path_for_diagnostics(raw_path: string): LogErrorPathIdentity {
  return summarize_log_error_path(raw_path);
}

/**
 * scheduler 错误上下文保留批次形状和 task 摘要，具体恢复仍读取后端权威快照。
 */
export function summarize_scheduler_error_context(
  context: DesktopRefreshSchedulerErrorContext,
): LogErrorContext {
  return {
    phase: context.phase,
    projectChanges: context.projectChanges.map(summarize_project_change_for_diagnostics),
    taskSnapshot:
      context.taskSnapshot === null
        ? null
        : summarize_task_snapshot_for_diagnostics(context.taskSnapshot),
  };
}
