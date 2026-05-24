import type { DesktopRuntimeRefreshSchedulerErrorContext } from "@/app/desktop/desktop-runtime-refresh-scheduler";
import type { TaskSnapshot } from "@/app/desktop/task-runtime-store";
import {
  normalize_section_array,
  normalize_section_revisions,
} from "@/app/desktop/desktop-runtime-event-payload";
import type { ProjectStoreChangeEvent } from "@/project/store/project-store";
import {
  summarize_diagnostic_path,
  type DiagnosticPathIdentity,
  type ErrorDiagnosticContext,
} from "@shared/error";

type RuntimeProjectDiagnosticsInput = {
  loaded: boolean;
  path: string;
  warmupStatus: string;
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
 * 项目诊断只保留运行态身份和 warmup 阶段，避免把 ProjectStore 大 section 写入异常日志。
 */
export function summarize_runtime_project_for_diagnostics(
  input: RuntimeProjectDiagnosticsInput,
): ErrorDiagnosticContext {
  return {
    loaded: input.loaded,
    path: summarize_path_for_diagnostics(input.path),
    warmupStatus: input.warmupStatus,
  };
}

/**
 * task 诊断只取状态和进度数字，避免把页面展示 extras 写入异常日志。
 */
export function summarize_task_snapshot_for_diagnostics(
  snapshot: TaskSnapshot,
): ErrorDiagnosticContext {
  return {
    runtimeRevision: snapshot.runtime_revision,
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
  event: ProjectStoreChangeEvent,
): ErrorDiagnosticContext {
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
): ErrorDiagnosticContext {
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
function summarize_path_for_diagnostics(raw_path: string): DiagnosticPathIdentity {
  return summarize_diagnostic_path(raw_path);
}

/**
 * scheduler 错误上下文保留批次形状和 task 摘要，具体恢复仍读取后端权威快照。
 */
export function summarize_scheduler_error_context(
  context: DesktopRuntimeRefreshSchedulerErrorContext,
): ErrorDiagnosticContext {
  return {
    phase: context.phase,
    projectChanges: context.projectChanges.map(summarize_project_change_for_diagnostics),
    taskSnapshot:
      context.taskSnapshot === null
        ? null
        : summarize_task_snapshot_for_diagnostics(context.taskSnapshot),
  };
}
