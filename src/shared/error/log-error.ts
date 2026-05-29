import type { LogLevel } from "../log";
import type { ApiJsonValue, AppError, AppErrorDiagnosticContext } from "./app-error";

// MAX LOG ERROR DEPTH 是模块级稳定契约，集中维护避免调用点散落魔术值。
const MAX_LOG_ERROR_DEPTH = 4;
// MAX LOG ERROR ARRAY ITEMS 是模块级稳定契约，集中维护避免调用点散落魔术值。
const MAX_LOG_ERROR_ARRAY_ITEMS = 24;
// MAX LOG ERROR OBJECT KEYS 是持久化或快捷键契约，集中保存避免调用点散落魔术字符串。
const MAX_LOG_ERROR_OBJECT_KEYS = 48;
// MAX LOG ERROR MESSAGE LENGTH 是模块级稳定契约，集中维护避免调用点散落魔术值。
const MAX_LOG_ERROR_MESSAGE_LENGTH = 4096;
// MAX LOG ERROR STACK LENGTH 是模块级稳定契约，集中维护避免调用点散落魔术值。
const MAX_LOG_ERROR_STACK_LENGTH = 16384;
// MAX LOG ERROR CAUSE CHAIN LENGTH 是模块级稳定契约，集中维护避免调用点散落魔术值。
const MAX_LOG_ERROR_CAUSE_CHAIN_LENGTH = 8;
// LOG ERROR PATH HASH OFFSET 是跨边界路径或地址契约，集中保存避免调用点散落魔术字符串。
const LOG_ERROR_PATH_HASH_OFFSET = 2166136261;
// LOG ERROR PATH HASH PRIME 是跨边界路径或地址契约，集中保存避免调用点散落魔术字符串。
const LOG_ERROR_PATH_HASH_PRIME = 16777619;

export type LogErrorContext = Record<string, ApiJsonValue>;
export type LogErrorContextInput = Record<string, unknown>;

export interface LogErrorCause {
  name?: string;
  message: string;
  stack?: string;
}

export interface LogError {
  name?: string;
  message: string;
  stack?: string;
  cause_chain?: LogErrorCause[];
  context?: LogErrorContext;
}

export interface LogErrorPathIdentity extends LogErrorContext {
  basename: string; // basename 只暴露路径末段，供定位文件类型或工程名
  pathHash: string; // pathHash 用稳定摘要关联同一路径，不泄露完整目录
  length: number; // length 辅助判断空路径、截断和路径形态
}

export interface LogErrorUrlIdentity extends LogErrorContext {
  scheme: string; // scheme 只保留协议类别，不暴露 URL 路径或查询参数
  hostHash: string; // hostHash 用稳定摘要关联同一宿主，不泄露 host / port 原文
  pathBasename: string; // pathBasename 只暴露 URL path 的末段
  hrefHash: string; // hrefHash 用于关联完整 URL 身份，不记录原始 href
  length: number; // length 辅助判断空 URL、截断和形态变化
}

export interface AppErrorLogSnapshot {
  level: Extract<LogLevel, "debug" | "warning" | "error" | "fatal">;
  error: LogError;
}

export interface AppErrorLogSnapshotOptions {
  fatal?: boolean;
  context?: AppErrorDiagnosticContext;
}

/**
 * 将未知异常归一为可跨线程、跨 API 传递的日志错误快照。
 */
export function to_log_error(error: unknown, context: LogErrorContextInput = {}): LogError {
  if (error instanceof Error) {
    return build_log_error_from_error(error, context);
  }

  if (is_log_error_like(error)) {
    return merge_log_error_context(normalize_log_error(error, "unknown_error"), context);
  }

  const raw_message = String(error ?? "unknown_error");
  const split = split_message_and_stack(raw_message, undefined);
  return prune_empty_log_error({
    message: split.message,
    ...(split.stack === undefined ? {} : { stack: split.stack }),
    ...normalize_optional_context(context),
  });
}

/**
 * 为业务失败文本构造日志错误快照，避免调用方伪造 Error 对象。
 */
export function log_error_from_message(
  message: string,
  context: LogErrorContextInput = {},
): LogError {
  const split = split_message_and_stack(message, undefined);
  return prune_empty_log_error({
    message: split.message,
    ...(split.stack === undefined ? {} : { stack: split.stack }),
    ...normalize_optional_context(context),
  });
}

/**
 * 收窄跨线程传回的日志错误对象，坏载荷只保留稳定 fallback 文案。
 */
export function normalize_log_error(value: unknown, fallback_message: string): LogError {
  if (!is_log_error_like(value)) {
    return log_error_from_message(fallback_message);
  }
  const record = value as Record<string, unknown>;
  const message =
    typeof record["message"] === "string" && record["message"].trim() !== ""
      ? record["message"]
      : fallback_message;
  const split = split_message_and_stack(
    message,
    typeof record["stack"] === "string" ? record["stack"] : undefined,
  );
  const cause_chain = normalize_cause_chain(record["cause_chain"]);
  return prune_empty_log_error({
    ...(typeof record["name"] === "string" && record["name"].trim() !== ""
      ? { name: trim_log_error_text(record["name"], MAX_LOG_ERROR_MESSAGE_LENGTH) }
      : {}),
    message: split.message,
    ...(split.stack === undefined ? {} : { stack: split.stack }),
    ...(cause_chain.length === 0 ? {} : { cause_chain }),
    ...normalize_optional_context(record["context"]),
  });
}

/**
 * 日志错误 context 只负责 JSON 化和裁剪；路径等敏感字段必须由调用边界先转成显式摘要值对象。
 */
export function sanitize_log_error_context(context: LogErrorContextInput): LogErrorContext {
  return sanitize_json_record(context, 0);
}

/**
 * renderer 崩溃和跨进程日志中的路径只保留 basename / hash / 长度，避免泄露完整目录。
 */
export function summarize_log_error_path(raw_path: string): LogErrorPathIdentity {
  const normalized_path = raw_path.trim();
  const parts = normalized_path.split(/[\\/]/u).filter((part) => part !== "");
  return {
    basename: parts.at(-1) ?? "",
    pathHash: build_log_error_identity_hash(normalized_path),
    length: normalized_path.length,
  };
}

/**
 * renderer URL 诊断只保留可关联的摘要身份，禁止记录完整路径、query 或 hash。
 */
export function summarize_log_error_url(raw_url: string): LogErrorUrlIdentity {
  const normalized_url = raw_url.trim();
  const parsed_url = parse_log_error_url(normalized_url);
  const path_parts = (parsed_url?.pathname ?? "")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  return {
    scheme: parsed_url?.protocol.replace(/:$/u, "") ?? "",
    hostHash: build_log_error_identity_hash(parsed_url?.host ?? ""),
    pathBasename: path_parts.at(-1) ?? "",
    hrefHash: build_log_error_identity_hash(normalized_url),
    length: normalized_url.length,
  };
}

/**
 * 日志快照保留 AppError 的公开 code/details 与 cause 链，但不依赖 Backend LogManager 实例。
 */
export function to_app_error_log_snapshot(
  error: AppError,
  options: AppErrorLogSnapshotOptions = {},
): AppErrorLogSnapshot {
  return {
    level: options.fatal === true ? "fatal" : resolve_app_error_log_level(error),
    error: to_log_error(error, {
      code: error.code,
      severity: error.severity,
      public_details: error.public_details,
      diagnostic_context: error.diagnostic_context,
      ...options.context,
    }),
  };
}

// is_log_error_like 在边界处归一化输入，避免下游再处理坏载荷分支。
function is_log_error_like(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// build_log_error_from_error 封装原生 Error 读取顺序，避免被普通对象快照分支提前吞掉 cause 链。
function build_log_error_from_error(error: Error, context: LogErrorContextInput): LogError {
  const split = split_message_and_stack(error.message, error.stack);
  const cause_chain = collect_log_error_cause_chain(error);
  return prune_empty_log_error({
    ...(error.name.trim() !== "" ? { name: error.name } : {}),
    message: split.message,
    ...(split.stack === undefined ? {} : { stack: split.stack }),
    ...(cause_chain.length === 0 ? {} : { cause_chain }),
    ...normalize_optional_context(context),
  });
}

// merge_log_error_context 封装当前模块的共享逻辑，避免重复实现同一维护规则。
function merge_log_error_context(error: LogError, context: LogErrorContextInput): LogError {
  const extra_context = sanitize_log_error_context(context);
  if (Object.keys(extra_context).length === 0) {
    return error;
  }
  return prune_empty_log_error({
    ...error,
    context: {
      ...error.context,
      ...extra_context,
    },
  });
}

// normalize_optional_context 在边界处归一化输入，避免下游再处理坏载荷分支。
function normalize_optional_context(value: unknown): { context?: LogErrorContext } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const context = sanitize_log_error_context(value as LogErrorContextInput);
  return Object.keys(context).length === 0 ? {} : { context };
}

// prune_empty_log_error 封装当前模块的共享逻辑，避免重复实现同一维护规则。
function prune_empty_log_error(payload: LogError): LogError {
  const message = payload.message.trim() === "" ? "unknown_error" : payload.message;
  return {
    ...(payload.name === undefined ? {} : { name: payload.name }),
    message,
    ...(payload.stack === undefined ? {} : { stack: payload.stack }),
    ...(payload.cause_chain === undefined || payload.cause_chain.length === 0
      ? {}
      : { cause_chain: payload.cause_chain }),
    ...(payload.context === undefined || Object.keys(payload.context).length === 0
      ? {}
      : { context: payload.context }),
  };
}

// split_message_and_stack 封装当前模块的共享逻辑，避免重复实现同一维护规则。
function split_message_and_stack(
  message: string,
  stack: string | undefined,
): { message: string; stack?: string } {
  const normalized_message = normalize_log_error_text(message);
  const normalized_stack =
    stack === undefined
      ? undefined
      : trim_log_error_text(normalize_log_error_text(stack), MAX_LOG_ERROR_STACK_LENGTH);
  const message_lines = normalized_message.split("\n");
  const stack_start_index = message_lines.findIndex((line) => /^\s*at\s+/u.test(line));
  if (stack_start_index < 0) {
    return {
      message: trim_log_error_text(normalized_message, MAX_LOG_ERROR_MESSAGE_LENGTH),
      ...(normalized_stack === undefined || normalized_stack === ""
        ? {}
        : { stack: normalized_stack }),
    };
  }
  const message_text = message_lines.slice(0, stack_start_index).join("\n").trim();
  const extracted_stack = message_lines.slice(stack_start_index).join("\n").trim();
  return {
    message: trim_log_error_text(message_text, MAX_LOG_ERROR_MESSAGE_LENGTH),
    stack: normalized_stack ?? trim_log_error_text(extracted_stack, MAX_LOG_ERROR_STACK_LENGTH),
  };
}

// collect_log_error_cause_chain 封装当前模块的共享逻辑，避免重复实现同一维护规则。
function collect_log_error_cause_chain(error: Error): LogErrorCause[] {
  const chain: LogErrorCause[] = [];
  let current: unknown = error.cause;
  while (
    current !== undefined &&
    current !== null &&
    chain.length < MAX_LOG_ERROR_CAUSE_CHAIN_LENGTH
  ) {
    if (current instanceof Error) {
      const split = split_message_and_stack(current.message, current.stack);
      chain.push({
        ...(current.name.trim() === "" ? {} : { name: current.name }),
        message: split.message,
        ...(split.stack === undefined ? {} : { stack: split.stack }),
      });
      current = current.cause;
      continue;
    }
    chain.push({
      name: typeof current,
      message: trim_log_error_text(String(current), MAX_LOG_ERROR_MESSAGE_LENGTH),
    });
    break;
  }
  return chain;
}

// normalize_cause_chain 在边界处归一化输入，避免下游再处理坏载荷分支。
function normalize_cause_chain(value: unknown): LogErrorCause[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.slice(0, MAX_LOG_ERROR_CAUSE_CHAIN_LENGTH).flatMap((item) => {
    if (!is_log_error_like(item)) {
      return [];
    }
    const record = item;
    if (typeof record["message"] !== "string" || record["message"].trim() === "") {
      return [];
    }
    const split = split_message_and_stack(
      record["message"],
      typeof record["stack"] === "string" ? record["stack"] : undefined,
    );
    return [
      {
        ...(typeof record["name"] === "string" && record["name"].trim() !== ""
          ? { name: trim_log_error_text(record["name"], MAX_LOG_ERROR_MESSAGE_LENGTH) }
          : {}),
        message: split.message,
        ...(split.stack === undefined ? {} : { stack: split.stack }),
      },
    ];
  });
}

// sanitize_json_record 封装当前模块的共享逻辑，避免重复实现同一维护规则。
function sanitize_json_record(record: Record<string, unknown>, depth: number): LogErrorContext {
  const entries = Object.entries(record).slice(0, MAX_LOG_ERROR_OBJECT_KEYS);
  return Object.fromEntries(
    entries.map(([entry_key, value]) => [entry_key, sanitize_value(value, depth)]),
  ) as LogErrorContext;
}

// sanitize_value 封装当前模块的共享逻辑，避免重复实现同一维护规则。
function sanitize_value(value: unknown, depth: number): ApiJsonValue {
  if (value === null) {
    return null;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === "string") {
    return trim_log_error_text(value, MAX_LOG_ERROR_MESSAGE_LENGTH);
  }
  if (Array.isArray(value)) {
    if (depth >= MAX_LOG_ERROR_DEPTH) {
      return `[array:${value.length.toString()}]`;
    }
    return value.slice(0, MAX_LOG_ERROR_ARRAY_ITEMS).map((item) => sanitize_value(item, depth + 1));
  }
  if (typeof value === "object") {
    if (depth >= MAX_LOG_ERROR_DEPTH) {
      return "[object]";
    }
    return sanitize_json_record(value as Record<string, unknown>, depth + 1);
  }
  return String(value);
}

// parse_log_error_url 收口外部文本解析，解析失败时由这里决定降级口径。
function parse_log_error_url(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

// build_log_error_identity_hash 构造跨层载荷，保证字段形状在一个入口维护。
function build_log_error_identity_hash(value: string): string {
  let hash = LOG_ERROR_PATH_HASH_OFFSET;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, LOG_ERROR_PATH_HASH_PRIME);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// normalize_log_error_text 在边界处归一化输入，避免下游再处理坏载荷分支。
function normalize_log_error_text(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

// trim_log_error_text 封装当前模块的共享逻辑，避免重复实现同一维护规则。
function trim_log_error_text(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}

function resolve_app_error_log_level(
  error: AppError,
): Extract<LogLevel, "debug" | "warning" | "error"> {
  switch (error.severity) {
    case "expected":
      return "debug";
    case "warning":
      return "warning";
    case "fault":
      return "error";
  }
}
