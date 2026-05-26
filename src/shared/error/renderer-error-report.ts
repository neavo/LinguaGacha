import {
  log_error_from_message,
  normalize_log_error,
  to_log_error,
  type LogError,
  type LogErrorContext,
} from "./log-error";
import {
  normalize_renderer_error_context,
  normalize_renderer_diagnostics_context_field,
  normalize_renderer_diagnostics_text,
  type RendererDiagnosticsContext,
  type RendererErrorContextInput,
} from "./renderer-diagnostics";

export interface RendererErrorReport extends Record<string, unknown> {
  source: string; // source 表示 renderer 内部上报来源，不等同 LogManager source
  error: LogError; // error 是异常本体的唯一结构化载体
  route?: string; // route 从当前 renderer 诊断上下文复制
  project?: LogErrorContext; // project 只允许轻量摘要
  task?: LogErrorContext; // task 只允许轻量摘要
  triggeringEvent?: LogErrorContext; // triggeringEvent 记录导致异常的事件头
  context?: LogErrorContext; // context 记录调用点补充的轻量业务上下文
}

export interface RendererErrorReportInput {
  source: string; // source 由调用点选择稳定词表
  error: unknown; // error 是当前捕获到的 JS 异常或 fallback 值
  logError?: LogError; // logError 用于保留 worker 等边界已生成的异常快照
  diagnosticsContext?: RendererDiagnosticsContext; // diagnosticsContext 是最近 route / project / task 快照
  triggeringEvent?: Record<string, unknown>; // triggeringEvent 由事件消费方传入事件头摘要
  context?: RendererErrorContextInput; // context 只允许 renderer error 白名单字段
}

/**
 * renderer 异常报告只通过结构化 error 进入 Gateway，避免 message / stack / context 多套契约并存。
 */
export function create_renderer_error_report(input: RendererErrorReportInput): RendererErrorReport {
  const error = input.logError ?? to_log_error(input.error);
  return normalize_renderer_error_report({
    source: input.source,
    error,
    route: input.diagnosticsContext?.route,
    project: input.diagnosticsContext?.project,
    task: input.diagnosticsContext?.task,
    triggeringEvent: input.triggeringEvent,
    context: input.context,
  });
}

/**
 * Gateway 不信任 renderer 输入；坏载荷会收窄成稳定 fallback 诊断。
 */
export function normalize_renderer_error_report(value: unknown): RendererErrorReport {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      source: "renderer",
      error: log_error_from_message("unknown_renderer_error"),
    };
  }
  const record = value as Record<string, unknown>;
  return {
    source: read_renderer_error_source(record["source"]),
    error: normalize_log_error(record["error"], "unknown_renderer_error"),
    ...read_optional_route_field(record),
    ...read_renderer_diagnostics_context_field(record, "project", "project"),
    ...read_renderer_diagnostics_context_field(record, "task", "task"),
    ...read_renderer_diagnostics_context_field(record, "triggeringEvent", "event"),
    ...read_optional_report_context_field(record),
  };
}

// read_optional_route_field 只读取边界事实并返回稳定快照，不在读取阶段产生写入副作用。
function read_optional_route_field(record: Record<string, unknown>): Record<string, string> {
  const route = normalize_renderer_diagnostics_text(record["route"]);
  return route === undefined ? {} : { route };
}

// read_renderer_diagnostics_context_field 只读取边界事实并返回稳定快照，不在读取阶段产生写入副作用。
function read_renderer_diagnostics_context_field(
  record: Record<string, unknown>,
  field: "project" | "task" | "triggeringEvent",
  diagnostics_key: "project" | "task" | "event",
): Record<string, LogErrorContext> {
  const context = normalize_renderer_diagnostics_context_field(record[field], diagnostics_key);
  return context === undefined ? {} : { [field]: context };
}

// read_optional_report_context_field 只读取边界事实并返回稳定快照，不在读取阶段产生写入副作用。
function read_optional_report_context_field(
  record: Record<string, unknown>,
): Record<string, LogErrorContext> {
  const context = normalize_renderer_error_context(record["context"]);
  return context === undefined ? {} : { context };
}

// read_renderer_error_source 只读取边界事实并返回稳定快照，不在读取阶段产生写入副作用。
function read_renderer_error_source(value: unknown): string {
  return normalize_renderer_diagnostics_text(value) ?? "renderer";
}
