import type { LogLevel } from "../log";
import type { JsonRecord, JsonValue } from "../../domain/json";
import type { AppError, AppErrorDiagnosticContext } from "./app-error";
import { is_app_error } from "./app-error";

// 日志快照限制嵌套、集合规模与文本长度，供跨线程传输和持久化共用。
const MAX_LOG_ERROR_DEPTH = 4;
const MAX_LOG_ERROR_ARRAY_ITEMS = 24;
const MAX_LOG_ERROR_OBJECT_KEYS = 48;
const MAX_LOG_ERROR_MESSAGE_LENGTH = 4096;
const MAX_LOG_ERROR_STACK_LENGTH = 16384;
const MAX_LOG_ERROR_CAUSE_CHAIN_LENGTH = 8;
// 固定种子和乘数使路径、URL 摘要能跨运行关联。
const LOG_ERROR_PATH_HASH_OFFSET = 2166136261;
const LOG_ERROR_PATH_HASH_PRIME = 16777619;

export type LogErrorContext = JsonRecord;
export type LogErrorContextInput = Record<string, unknown>;

interface LogErrorCause {
  name?: string;
  message: string;
  stack?: string;
  context?: LogErrorContext; // 随异常快照传递的诊断字段。
}

export interface LogError {
  name?: string;
  message: string;
  stack?: string;
  cause_chain?: LogErrorCause[];
  context?: LogErrorContext; // 随异常快照传递的诊断字段。
}

export interface LogErrorPathIdentity extends LogErrorContext {
  basename: string; // 只暴露路径末段，供定位文件类型或工程名
  pathHash: string; // 用稳定摘要关联同一路径，不泄露完整目录
  length: number; // 辅助判断空路径、截断和路径形态
}

interface LogErrorUrlIdentity extends LogErrorContext {
  scheme: string; // 只保留协议类别，不暴露 URL 路径或查询参数
  hostHash: string; // 用稳定摘要关联同一宿主，不泄露 host / port 原文
  pathBasename: string; // 只暴露 URL path 的末段
  hrefHash: string; // 用于关联完整 URL 身份，不记录原始 href
  length: number; // 辅助判断空 URL、截断和形态变化
}

interface AppErrorLogSnapshot {
  level: Extract<LogLevel, "debug" | "warning" | "error" | "fatal">;
  error: LogError;
}

interface AppErrorLogSnapshotOptions {
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
  const record = value;
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

/** 将跨线程异常快照收窄为对象记录。 */
function is_log_error_like(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// 封装原生 Error 读取顺序，避免被普通对象快照分支提前吞掉 cause 链。
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

/** 合并调用现场的诊断字段，后传字段优先。 */
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

/** 序列化有效上下文，省略空记录。 */
function normalize_optional_context(value: unknown): { context?: LogErrorContext } {
  if (!is_log_error_like(value)) return {};
  const context = sanitize_log_error_context(value);
  return Object.keys(context).length === 0 ? {} : { context };
}

/** 省略空诊断字段，保留可展示的错误消息。 */
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

/** 分离混入消息的调用栈，已有独立堆栈优先。 */
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

/** 展开原因与聚合异常，同一异常只保留一次，并限制输出长度。 */
function collect_log_error_cause_chain(error: Error): LogErrorCause[] {
  const chain: LogErrorCause[] = [];
  const pending: unknown[] = // 待展开的异常允许共享或循环引用。
    error instanceof AggregateError
      ? [...error.errors.slice(0, MAX_LOG_ERROR_CAUSE_CHAIN_LENGTH), error.cause]
      : [error.cause];
  const visited = new Set<unknown>([error]); // 去重已展开的异常，避免重复占用原因列表。
  // 先展开业务失败，再展开收尾失败，保持诊断顺序。
  while (pending.length > 0 && chain.length < MAX_LOG_ERROR_CAUSE_CHAIN_LENGTH) {
    const current = pending.shift();
    if (current === undefined || current === null || visited.has(current)) continue;
    visited.add(current);
    if (current instanceof Error) {
      const split = split_message_and_stack(current.message, current.stack);
      chain.push({
        ...(current.name.trim() === "" ? {} : { name: current.name }),
        message: split.message,
        ...(split.stack === undefined ? {} : { stack: split.stack }),
        ...(is_app_error(current)
          ? normalize_optional_context({ code: current.code, ...current.diagnostic_context })
          : {}),
      });
      pending.unshift(
        ...(current instanceof AggregateError
          ? current.errors.slice(0, MAX_LOG_ERROR_CAUSE_CHAIN_LENGTH - chain.length)
          : []),
        current.cause,
      );
      continue;
    }
    // worker 在本地 Error.cause 中保留 LogError 快照，继续展开才能保留远端调用栈。
    if (is_log_error_like(current) && typeof current["message"] === "string") {
      const snapshot = normalize_log_error(current, "unknown_error");
      const causes = normalize_cause_chain([snapshot, ...(snapshot.cause_chain ?? [])]);
      chain.push(...causes.slice(0, MAX_LOG_ERROR_CAUSE_CHAIN_LENGTH - chain.length));
      continue;
    }
    chain.push({
      name: typeof current,
      message: trim_log_error_text(String(current), MAX_LOG_ERROR_MESSAGE_LENGTH),
    });
  }
  return chain;
}

/** 校验跨线程原因列表并统一文本、堆栈和上下文。 */
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
        ...normalize_optional_context(record["context"]),
      },
    ];
  });
}

/** 限制上下文字段数量，并递归转换字段值。 */
function sanitize_json_record(record: Record<string, unknown>, depth: number): LogErrorContext {
  const entries = Object.entries(record).slice(0, MAX_LOG_ERROR_OBJECT_KEYS);
  return Object.fromEntries(
    entries.map(([entry_key, value]) => [entry_key, sanitize_value(value, depth)]),
  ) as LogErrorContext;
}

/** 将诊断值转为有限深度的 JSON，保留特殊值的文字表示。 */
function sanitize_value(value: unknown, depth: number): JsonValue {
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

/** 解析诊断 URL，非法输入交给摘要调用方处理。 */
function parse_log_error_url(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** 计算稳定摘要，以关联同一路径或 URL。 */
function build_log_error_identity_hash(value: string): string {
  let hash = LOG_ERROR_PATH_HASH_OFFSET;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, LOG_ERROR_PATH_HASH_PRIME);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** 统一换行并清理首尾空白。 */
function normalize_log_error_text(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

/** 按日志长度上限裁剪文本。 */
function trim_log_error_text(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}

/** 将业务错误严重度映射为日志等级。 */
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
