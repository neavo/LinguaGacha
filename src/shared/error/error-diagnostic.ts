import type { ApiJsonValue } from "./app-error";

// MAX DIAGNOSTIC DEPTH 是模块级稳定契约，集中维护避免调用点散落魔术值。
const MAX_DIAGNOSTIC_DEPTH = 4;
// MAX DIAGNOSTIC ARRAY ITEMS 是模块级稳定契约，集中维护避免调用点散落魔术值。
const MAX_DIAGNOSTIC_ARRAY_ITEMS = 24;
// MAX DIAGNOSTIC OBJECT KEYS 是持久化或快捷键契约，集中保存避免调用点散落魔术字符串。
const MAX_DIAGNOSTIC_OBJECT_KEYS = 48;
// MAX DIAGNOSTIC MESSAGE LENGTH 是模块级稳定契约，集中维护避免调用点散落魔术值。
const MAX_DIAGNOSTIC_MESSAGE_LENGTH = 4096;
// MAX DIAGNOSTIC STACK LENGTH 是模块级稳定契约，集中维护避免调用点散落魔术值。
const MAX_DIAGNOSTIC_STACK_LENGTH = 16384;
// MAX CAUSE CHAIN LENGTH 是模块级稳定契约，集中维护避免调用点散落魔术值。
const MAX_CAUSE_CHAIN_LENGTH = 8;
// DIAGNOSTIC PATH HASH OFFSET 是跨边界路径或地址契约，集中保存避免调用点散落魔术字符串。
const DIAGNOSTIC_PATH_HASH_OFFSET = 2166136261;
// DIAGNOSTIC PATH HASH PRIME 是跨边界路径或地址契约，集中保存避免调用点散落魔术字符串。
const DIAGNOSTIC_PATH_HASH_PRIME = 16777619;

export type ErrorDiagnosticContext = Record<string, ApiJsonValue>;
export type ErrorDiagnosticContextInput = Record<string, unknown>;

export interface ErrorDiagnosticCause {
  name?: string;
  message: string;
  stack?: string;
}

export interface ErrorDiagnosticPayload {
  name?: string;
  message: string;
  stack?: string;
  cause_chain?: ErrorDiagnosticCause[];
  context?: ErrorDiagnosticContext;
}

export interface ErrorDiagnosticLogFields {
  error_message: string;
  stack?: string;
  context?: ErrorDiagnosticContext;
}

export interface DiagnosticPathIdentity extends ErrorDiagnosticContext {
  basename: string; // basename 只暴露路径末段，供定位文件类型或工程名
  pathHash: string; // pathHash 用稳定摘要关联同一路径，不泄露完整目录
  length: number; // length 辅助判断空路径、截断和路径形态
}

export interface DiagnosticUrlIdentity extends ErrorDiagnosticContext {
  scheme: string; // scheme 只保留协议类别，不暴露 URL 路径或查询参数
  hostHash: string; // hostHash 用稳定摘要关联同一宿主，不泄露 host / port 原文
  pathBasename: string; // pathBasename 只暴露 URL path 的末段
  hrefHash: string; // hrefHash 用于关联完整 URL 身份，不记录原始 href
  length: number; // length 辅助判断空 URL、截断和形态变化
}

/**
 * 将未知异常归一为可跨线程、跨 API 传递的诊断快照。
 */
export function to_error_diagnostic(
  error: unknown,
  context: ErrorDiagnosticContextInput = {},
): ErrorDiagnosticPayload {
  const raw_message = error instanceof Error ? error.message : String(error ?? "unknown_error");
  const raw_stack = error instanceof Error ? error.stack : undefined;
  const split = split_message_and_stack(raw_message, raw_stack);
  const cause_chain = error instanceof Error ? collect_diagnostic_cause_chain(error) : [];
  return prune_empty_diagnostic({
    ...(error instanceof Error && error.name.trim() !== "" ? { name: error.name } : {}),
    message: split.message,
    ...(split.stack === undefined ? {} : { stack: split.stack }),
    ...(cause_chain.length === 0 ? {} : { cause_chain }),
    ...normalize_optional_context(context),
  });
}

/**
 * 为业务失败文本构造诊断快照，避免调用方伪造 Error 对象。
 */
export function error_diagnostic_from_message(
  message: string,
  context: ErrorDiagnosticContextInput = {},
): ErrorDiagnosticPayload {
  const split = split_message_and_stack(message, undefined);
  return prune_empty_diagnostic({
    message: split.message,
    ...(split.stack === undefined ? {} : { stack: split.stack }),
    ...normalize_optional_context(context),
  });
}

/**
 * 收窄跨线程传回的诊断对象，坏载荷只保留稳定 fallback 文案。
 */
export function normalize_error_diagnostic(
  value: unknown,
  fallback_message: string,
): ErrorDiagnosticPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return error_diagnostic_from_message(fallback_message);
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
  return prune_empty_diagnostic({
    ...(typeof record["name"] === "string" && record["name"].trim() !== ""
      ? { name: trim_diagnostic_text(record["name"], MAX_DIAGNOSTIC_MESSAGE_LENGTH) }
      : {}),
    message: split.message,
    ...(split.stack === undefined ? {} : { stack: split.stack }),
    ...(cause_chain.length === 0 ? {} : { cause_chain }),
    ...normalize_optional_context(record["context"]),
  });
}

/**
 * 将诊断快照映射到 LogManager 的错误字段，保持 message 摘要和异常细节分离。
 */
export function error_diagnostic_to_log_fields(
  diagnostic: ErrorDiagnosticPayload,
): ErrorDiagnosticLogFields {
  const context: ErrorDiagnosticContext = {
    ...diagnostic.context,
    ...(diagnostic.name === undefined ? {} : { error_name: diagnostic.name }),
    ...(diagnostic.cause_chain === undefined
      ? {}
      : { cause_chain: diagnostic.cause_chain as unknown as ApiJsonValue }),
  };
  return {
    error_message: diagnostic.message,
    ...(diagnostic.stack === undefined ? {} : { stack: diagnostic.stack }),
    ...(Object.keys(context).length === 0 ? {} : { context }),
  };
}

/**
 * 诊断 context 只负责 JSON 化和裁剪；路径等敏感字段必须由调用边界先转成显式摘要值对象。
 */
export function sanitize_error_diagnostic_context(
  context: ErrorDiagnosticContextInput,
): ErrorDiagnosticContext {
  return sanitize_json_record(context, 0);
}

/**
 * renderer 崩溃和跨进程日志中的路径只保留 basename / hash / 长度，避免泄露完整目录。
 */
export function summarize_diagnostic_path(raw_path: string): DiagnosticPathIdentity {
  const normalized_path = raw_path.trim();
  const parts = normalized_path.split(/[\\/]/u).filter((part) => part !== "");
  return {
    basename: parts.at(-1) ?? "",
    pathHash: build_diagnostic_identity_hash(normalized_path),
    length: normalized_path.length,
  };
}

/**
 * renderer URL 诊断只保留可关联的摘要身份，禁止记录完整路径、query 或 hash。
 */
export function summarize_diagnostic_url(raw_url: string): DiagnosticUrlIdentity {
  const normalized_url = raw_url.trim();
  const parsed_url = parse_diagnostic_url(normalized_url);
  const path_parts = (parsed_url?.pathname ?? "")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  return {
    scheme: parsed_url?.protocol.replace(/:$/u, "") ?? "",
    hostHash: build_diagnostic_identity_hash(parsed_url?.host ?? ""),
    pathBasename: path_parts.at(-1) ?? "",
    hrefHash: build_diagnostic_identity_hash(normalized_url),
    length: normalized_url.length,
  };
}

// normalize_optional_context 在边界处归一化输入，避免下游再处理坏载荷分支。
function normalize_optional_context(value: unknown): { context?: ErrorDiagnosticContext } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const context = sanitize_error_diagnostic_context(value as ErrorDiagnosticContextInput);
  return Object.keys(context).length === 0 ? {} : { context };
}

// prune_empty_diagnostic 封装当前模块的共享逻辑，避免重复实现同一维护规则。
function prune_empty_diagnostic(payload: ErrorDiagnosticPayload): ErrorDiagnosticPayload {
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
  const normalized_message = normalize_diagnostic_text(message);
  const normalized_stack =
    stack === undefined
      ? undefined
      : trim_diagnostic_text(normalize_diagnostic_text(stack), MAX_DIAGNOSTIC_STACK_LENGTH);
  const message_lines = normalized_message.split("\n");
  const stack_start_index = message_lines.findIndex((line) => /^\s*at\s+/u.test(line));
  if (stack_start_index < 0) {
    return {
      message: trim_diagnostic_text(normalized_message, MAX_DIAGNOSTIC_MESSAGE_LENGTH),
      ...(normalized_stack === undefined || normalized_stack === ""
        ? {}
        : { stack: normalized_stack }),
    };
  }
  const message_text = message_lines.slice(0, stack_start_index).join("\n").trim();
  const extracted_stack = message_lines.slice(stack_start_index).join("\n").trim();
  return {
    message: trim_diagnostic_text(message_text, MAX_DIAGNOSTIC_MESSAGE_LENGTH),
    stack: normalized_stack ?? trim_diagnostic_text(extracted_stack, MAX_DIAGNOSTIC_STACK_LENGTH),
  };
}

// collect_diagnostic_cause_chain 封装当前模块的共享逻辑，避免重复实现同一维护规则。
function collect_diagnostic_cause_chain(error: Error): ErrorDiagnosticCause[] {
  const chain: ErrorDiagnosticCause[] = [];
  let current: unknown = error.cause;
  while (current !== undefined && current !== null && chain.length < MAX_CAUSE_CHAIN_LENGTH) {
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
      message: trim_diagnostic_text(String(current), MAX_DIAGNOSTIC_MESSAGE_LENGTH),
    });
    break;
  }
  return chain;
}

// normalize_cause_chain 在边界处归一化输入，避免下游再处理坏载荷分支。
function normalize_cause_chain(value: unknown): ErrorDiagnosticCause[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.slice(0, MAX_CAUSE_CHAIN_LENGTH).flatMap((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return [];
    }
    const record = item as Record<string, unknown>;
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
          ? { name: trim_diagnostic_text(record["name"], MAX_DIAGNOSTIC_MESSAGE_LENGTH) }
          : {}),
        message: split.message,
        ...(split.stack === undefined ? {} : { stack: split.stack }),
      },
    ];
  });
}

// sanitize_json_record 封装当前模块的共享逻辑，避免重复实现同一维护规则。
function sanitize_json_record(
  record: Record<string, unknown>,
  depth: number,
): ErrorDiagnosticContext {
  const entries = Object.entries(record).slice(0, MAX_DIAGNOSTIC_OBJECT_KEYS);
  return Object.fromEntries(
    entries.map(([entry_key, value]) => [entry_key, sanitize_value(value, depth)]),
  ) as ErrorDiagnosticContext;
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
    return trim_diagnostic_text(value, MAX_DIAGNOSTIC_MESSAGE_LENGTH);
  }
  if (Array.isArray(value)) {
    if (depth >= MAX_DIAGNOSTIC_DEPTH) {
      return `[array:${value.length.toString()}]`;
    }
    return value
      .slice(0, MAX_DIAGNOSTIC_ARRAY_ITEMS)
      .map((item) => sanitize_value(item, depth + 1));
  }
  if (typeof value === "object") {
    if (depth >= MAX_DIAGNOSTIC_DEPTH) {
      return "[object]";
    }
    return sanitize_json_record(value as Record<string, unknown>, depth + 1);
  }
  return String(value);
}

// parse_diagnostic_url 收口外部文本解析，解析失败时由这里决定降级口径。
function parse_diagnostic_url(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

// build_diagnostic_identity_hash 构造跨层载荷，保证字段形状在一个入口维护。
function build_diagnostic_identity_hash(value: string): string {
  let hash = DIAGNOSTIC_PATH_HASH_OFFSET;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, DIAGNOSTIC_PATH_HASH_PRIME);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// normalize_diagnostic_text 在边界处归一化输入，避免下游再处理坏载荷分支。
function normalize_diagnostic_text(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

// trim_diagnostic_text 封装当前模块的共享逻辑，避免重复实现同一维护规则。
function trim_diagnostic_text(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}
