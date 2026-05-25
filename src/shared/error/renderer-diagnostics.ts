import type { ErrorDiagnosticContext, ErrorDiagnosticContextInput } from "./error-diagnostic";
import {
  sanitize_error_diagnostic_context,
  summarize_diagnostic_path,
  summarize_diagnostic_url,
} from "./error-diagnostic";

// MAX RENDERER DIAGNOSTIC TEXT LENGTH 是模块级稳定契约，集中维护避免调用点散落魔术值。
const MAX_RENDERER_DIAGNOSTIC_TEXT_LENGTH = 4096;
// renderer 黑匣子只接收本地摘要字段，避免 shared error 的通用 sanitizer 记录完整业务 payload。
const RENDERER_DIAGNOSTIC_CONTEXT_KEYS = {
  project: ["loaded", "path", "projectPath", "projectRevision", "runtimeRevision", "sessionStatus"],
  task: ["runtimeRevision", "taskType", "status", "busy", "requestInFlightCount", "progress"],
  event: [
    "topic",
    "eventId",
    "source",
    "projectPath",
    "projectRevision",
    "updatedSections",
    "sectionRevisions",
    "operationCount",
    "task",
    "keys",
    "operation",
    "change",
    "changeCount",
    "projectChanges",
    "phase",
    "taskSnapshot",
  ],
} as const;

export type RendererDiagnosticsContextKey = keyof typeof RENDERER_DIAGNOSTIC_CONTEXT_KEYS;

// renderer 黑匣子边界显式声明哪些字段是路径身份，shared sanitizer 不再按 key 猜测。
const RENDERER_DIAGNOSTIC_PATH_KEYS = new Set<string>(["path", "projectPath"]);

// renderer error context 是实际异常的轻量补充信息，不能成为任意业务 payload 逃生口。
const RENDERER_ERROR_CONTEXT_KEYS = [
  "stage",
  "reason",
  "recovery",
  "operation",
  "phase",
  "taskType",
  "page",
  "mode",
  "signalSeq",
  "itemIdCount",
  "componentStack",
  "eventKind",
  "filename",
  "line",
  "column",
  "location",
] as const;

// RendererErrorContextKey 是 renderer 实际异常补充上下文的唯一字段词表。
export type RendererErrorContextKey = (typeof RENDERER_ERROR_CONTEXT_KEYS)[number];

// RendererErrorContextInput 只允许白名单字段，调用点不能传入自定义业务对象。
export type RendererErrorContextInput = Partial<Record<RendererErrorContextKey, unknown>>;

// RENDERER ERROR CONTEXT PATH KEYS 是跨边界路径或地址契约，集中保存避免调用点散落魔术字符串。
const RENDERER_ERROR_CONTEXT_PATH_KEYS = new Set<RendererErrorContextKey>(["filename"]);
// RENDERER ERROR CONTEXT URL KEYS 是跨边界路径或地址契约，集中保存避免调用点散落魔术字符串。
const RENDERER_ERROR_CONTEXT_URL_KEYS = new Set<RendererErrorContextKey>(["location"]);

export type RendererDiagnosticsContext = {
  route?: string; // route 定位当前 renderer 页面区域
  project?: ErrorDiagnosticContext; // project 只保存项目身份和 revision 级摘要
  task?: ErrorDiagnosticContext; // task 只保存任务状态和进度级摘要
};

export type RendererDiagnosticsPayload = RendererDiagnosticsContext & {
  event?: ErrorDiagnosticContext; // event 保存最近触发事件头，禁止完整业务 payload
};

/**
 * renderer 诊断快照是 main 侧崩溃黑匣子的唯一载荷形状。
 */
export function normalize_renderer_diagnostics_payload(value: unknown): RendererDiagnosticsPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const record = value as Record<string, unknown>;
  return {
    ...read_optional_route_field(record),
    ...read_optional_context_field(record, "project", "project"),
    ...read_optional_context_field(record, "task", "task"),
    ...read_optional_context_field(record, "event", "event"),
  };
}

/**
 * renderer 诊断短文本统一裁剪，异常报告和崩溃面包屑共用同一口径。
 */
export function normalize_renderer_diagnostics_text(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }
  return trim_renderer_diagnostic_text(value);
}

/**
 * renderer 诊断上下文字段必须先过白名单和路径摘要，再交给 shared JSON 裁剪。
 */
export function normalize_renderer_diagnostics_context_field(
  value: unknown,
  key: RendererDiagnosticsContextKey,
): ErrorDiagnosticContext | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const context = sanitize_error_diagnostic_context(pick_renderer_diagnostic_context(value, key));
  return Object.keys(context).length === 0 ? undefined : context;
}

/**
 * renderer error context 只接收白名单字段；敏感身份字段在这里转成摘要值对象。
 */
export function normalize_renderer_error_context(
  value: unknown,
): ErrorDiagnosticContext | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const context = sanitize_error_diagnostic_context(pick_renderer_error_context(value));
  return Object.keys(context).length === 0 ? undefined : context;
}

// read_optional_route_field 只读取边界事实并返回稳定快照，不在读取阶段产生写入副作用。
function read_optional_route_field(record: Record<string, unknown>): Record<string, string> {
  const route = normalize_renderer_diagnostics_text(record["route"]);
  return route === undefined ? {} : { route };
}

// read_optional_context_field 只读取边界事实并返回稳定快照，不在读取阶段产生写入副作用。
function read_optional_context_field(
  record: Record<string, unknown>,
  field: "project" | "task" | "event",
  key: RendererDiagnosticsContextKey,
): Record<string, ErrorDiagnosticContext> {
  const context = normalize_renderer_diagnostics_context_field(record[field], key);
  return context === undefined ? {} : { [field]: context };
}

// pick_renderer_diagnostic_context 封装当前模块的共享逻辑，避免重复实现同一维护规则。
function pick_renderer_diagnostic_context(
  value: object,
  key: keyof typeof RENDERER_DIAGNOSTIC_CONTEXT_KEYS,
): ErrorDiagnosticContextInput {
  // 字段白名单属于 renderer 黑匣子边界，不回流到 shared error 通用 sanitizer。
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    RENDERER_DIAGNOSTIC_CONTEXT_KEYS[key].flatMap((context_key) => {
      if (!(context_key in record)) {
        return [];
      }
      return [[context_key, summarize_renderer_diagnostic_context_value(context_key, record)]];
    }),
  );
}

// summarize_renderer_diagnostic_context_value 封装当前模块的共享逻辑，避免重复实现同一维护规则。
function summarize_renderer_diagnostic_context_value(
  context_key: string,
  record: Record<string, unknown>,
): unknown {
  const value = record[context_key];
  if (RENDERER_DIAGNOSTIC_PATH_KEYS.has(context_key) && typeof value === "string") {
    return summarize_diagnostic_path(value);
  }
  return value;
}

// pick_renderer_error_context 封装当前模块的共享逻辑，避免重复实现同一维护规则。
function pick_renderer_error_context(value: object): ErrorDiagnosticContextInput {
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    RENDERER_ERROR_CONTEXT_KEYS.flatMap((context_key) => {
      if (!(context_key in record)) {
        return [];
      }
      return [[context_key, summarize_renderer_error_context_value(context_key, record)]];
    }),
  );
}

// summarize_renderer_error_context_value 封装当前模块的共享逻辑，避免重复实现同一维护规则。
function summarize_renderer_error_context_value(
  context_key: RendererErrorContextKey,
  record: Record<string, unknown>,
): unknown {
  const value = record[context_key];
  if (RENDERER_ERROR_CONTEXT_PATH_KEYS.has(context_key)) {
    return typeof value === "string"
      ? summarize_diagnostic_path(value)
      : summarize_diagnostic_path("");
  }
  if (RENDERER_ERROR_CONTEXT_URL_KEYS.has(context_key)) {
    return typeof value === "string"
      ? summarize_diagnostic_url(value)
      : summarize_diagnostic_url("");
  }
  return value;
}

// trim_renderer_diagnostic_text 封装当前模块的共享逻辑，避免重复实现同一维护规则。
function trim_renderer_diagnostic_text(value: string): string {
  const text = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  return text.length > MAX_RENDERER_DIAGNOSTIC_TEXT_LENGTH
    ? `${text.slice(0, MAX_RENDERER_DIAGNOSTIC_TEXT_LENGTH)}...`
    : text;
}
