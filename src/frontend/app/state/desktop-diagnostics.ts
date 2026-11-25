import type { BatchTaskListSnapshot } from "@domain/batch-task";

import {
  normalize_section_array,
  normalize_section_revisions,
} from "@frontend/app/state/desktop-event-payload";
import type { ProjectChangeEventForState } from "@frontend/app/state/desktop-project-change-types";
import { summarize_log_error_path, type LogErrorContext } from "@shared/error";

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
    path: summarize_log_error_path(input.path),
    sessionStatus: input.sessionStatus,
  };
}

/** 诊断只读取活跃状态与在途请求数。 */
export function summarize_task_snapshot_for_diagnostics({
  tasks,
  revision,
}: BatchTaskListSnapshot): LogErrorContext {
  return {
    runRevision: revision,
    status:
      tasks.length === 0
        ? "idle"
        : tasks.every((task) => task.status === "stopping")
          ? "stopping"
          : "running",
    requestInFlightCount: tasks.reduce((count, task) => count + task.request_in_flight_count, 0),
  };
}

/**
 * 项目事件诊断只记录事件身份和受影响范围。
 */
export function summarize_project_change_for_diagnostics(
  event: ProjectChangeEventForState,
): LogErrorContext {
  return {
    eventId: event.eventId ?? "",
    source: event.source,
    projectPath: summarize_log_error_path(event.projectPath),
    projectRevision: event.projectRevision,
    updatedSections: event.updatedSections,
    sectionRevisions: event.sectionRevisions ?? {},
    qualityStatisticsScope: event.qualityStatisticsScope,
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
    projectPath: summarize_log_error_path(String(payload.projectPath ?? "")),
    projectRevision: Number(payload.projectRevision ?? 0),
    updatedSections: normalize_section_array(payload.updatedSections),
    sectionRevisions: normalize_section_revisions(payload.sectionRevisions) ?? {},
  };
}

/**
 * scheduler 错误上下文保留批次形状和 task 摘要，具体恢复仍读取后端权威快照。
 */
