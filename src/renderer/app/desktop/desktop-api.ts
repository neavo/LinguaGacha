import { JsonTool } from "../../../shared/utils/json-tool";
import { normalize_core_api_base_url } from "@core/api/api-base-url";
import { normalize_log_level, type LogDetail, type LogEvent, type LogLevel } from "@shared/log";
import {
  normalize_log_error,
  type ApiErrorPayload,
  type AppErrorCode,
  type RendererErrorReport,
} from "@shared/error";

export type { LogDetail, LogEvent, LogLevel };

type ApiEnvelope<data_type> = {
  ok: boolean;
  data?: data_type;
  error?: Partial<ApiErrorPayload>;
};

type HealthPayload = {
  status?: string;
  service?: string;
  version?: string;
};

type GithubReleasePayload = {
  tag_name?: unknown;
  html_url?: unknown;
};

export type CoreMetadata = {
  version: string;
};

export type GithubReleaseUpdate = {
  latest_version: string;
  release_url: string;
};

type EventSourceJsonEvent = {
  type: string;
  [key: string]: unknown;
};

type SemanticVersion = {
  major: number;
  minor: number;
  patch: number;
};

export type DesktopLocalErrorCode =
  | "missing_core_api_base_url"
  | "core_api_unavailable"
  | "core_metadata_unavailable"
  | "event_stream_failed"
  | "http_error"
  | "network_failed"
  | "timeout";

export type DesktopApiErrorCode = AppErrorCode | DesktopLocalErrorCode;
export type DesktopLocalErrorMessageKey = `app.error.desktop.${DesktopLocalErrorCode}.message`;

// CORE API HEALTH PATH 是跨边界路径或地址契约，集中保存避免调用点散落魔术字符串。
const CORE_API_HEALTH_PATH = "/api/health";
// CORE API SERVICE NAME 是模块级稳定契约，集中维护避免调用点散落魔术值。
const CORE_API_SERVICE_NAME = "linguagacha-core";
// CORE API PROBE TIMEOUT MS 是运行时节流或容量阈值，集中保存便于评估性能影响。
const CORE_API_PROBE_TIMEOUT_MS = 300;
const GITHUB_LATEST_RELEASE_URL = "https://api.github.com/repos/neavo/LinguaGacha/releases/latest";

let cached_core_api_base_url: string | null = null;
let cached_core_metadata: CoreMetadata | null = null;
let pending_core_api_base_url_resolution: Promise<string> | null = null;

/**
 * 携带 Core API 错误码，保持渲染层错误分支可判定
 */
export class DesktopApiError extends Error {
  code: DesktopApiErrorCode;
  status: number;
  details: Record<string, unknown>;
  action: string | null;
  message_key: string | null;
  request_id: string | null;

  /**
   * 初始化 DesktopApiError 依赖，保留 renderer 可判定的错误元数据
   */
  constructor(args: {
    message: string;
    code: DesktopApiErrorCode;
    status: number;
    details?: Record<string, unknown>;
    action?: string;
    message_key?: string;
    request_id?: string;
  }) {
    super(args.message);
    this.name = "DesktopApiError";
    this.code = args.code;
    this.status = args.status;
    this.details = args.details ?? {};
    this.action = args.action ?? null;
    this.message_key = args.message_key ?? null;
    this.request_id = args.request_id ?? null;
  }

  /**
   * 本地 renderer 错误使用同一类，避免页面判断 Error.message
   */
  public static local(
    code: DesktopLocalErrorCode,
    status = 500,
    details: Record<string, unknown> = {},
  ): DesktopApiError {
    const message_key = build_desktop_local_error_message_key(code);
    return new DesktopApiError({ code, details, message: message_key, message_key, status });
  }
}

// build_desktop_local_error_message_key 构造跨层载荷，保证字段形状在一个入口维护。
function build_desktop_local_error_message_key(
  code: DesktopLocalErrorCode,
): DesktopLocalErrorMessageKey {
  return `app.error.desktop.${code}.message`;
}

// build_desktop_api_error 构造跨层载荷，保证字段形状在一个入口维护。
function build_desktop_api_error<data_type>(
  path: string,
  response: Response,
  payload: ApiEnvelope<data_type> | null,
): DesktopApiError {
  const error = payload?.error;
  const fallback_message_key = build_desktop_local_error_message_key("http_error");
  return new DesktopApiError({
    message: error?.message ?? fallback_message_key,
    code: error?.code ?? "http_error",
    status: response.status,
    details: error?.details ?? { path },
    action: error?.action,
    message_key: error?.message_key ?? fallback_message_key,
    request_id: error?.request_id,
  });
}

// read_api_envelope 只读取边界事实并返回稳定快照，不在读取阶段产生写入副作用。
async function read_api_envelope<data_type>(
  response: Response,
): Promise<ApiEnvelope<data_type> | null> {
  try {
    return (await response.json()) as ApiEnvelope<data_type>;
  } catch {
    return null;
  }
}

// create_network_error 构造跨层载荷，保证字段形状在一个入口维护。
function create_network_error(path: string, cause: unknown): DesktopApiError {
  const code: DesktopLocalErrorCode =
    cause instanceof Error && cause.name === "AbortError" ? "timeout" : "network_failed";
  const message_key = build_desktop_local_error_message_key(code);
  return new DesktopApiError({
    message: message_key,
    code,
    details: { path },
    message_key,
    status: 503,
  });
}

// read_core_api_base_url 只读取边界事实并返回稳定快照，不在读取阶段产生写入副作用。
function read_core_api_base_url(): string {
  const base_url = normalize_core_api_base_url(window.desktopApp.coreApi.baseUrl);

  if (base_url === "") {
    throw DesktopApiError.local("missing_core_api_base_url", 500);
  }

  return base_url;
}

// build_api_url 构造跨层载荷，保证字段形状在一个入口维护。
function build_api_url(base_url: string, path: string): string {
  const normalized_path = path.startsWith("/") ? path : `/${path}`;
  return `${base_url}${normalized_path}`;
}

// parse_event_source_payload 收口外部文本解析，解析失败时由这里决定降级口径。
function parse_event_source_payload(event: MessageEvent<string>): Record<string, unknown> {
  try {
    return JsonTool.parseStrict<Record<string, unknown>>(event.data);
  } catch {
    return {};
  }
}

// normalize_core_metadata 在边界处归一化输入，避免下游再处理坏载荷分支。
function normalize_core_metadata(payload: HealthPayload): CoreMetadata | null {
  const version = payload.version?.trim();
  if (version === undefined || version === "") {
    return null;
  }

  return { version };
}

// parse_semantic_version 收口外部文本解析，解析失败时由这里决定降级口径。
function parse_semantic_version(value: string): SemanticVersion | null {
  const version_match = value.match(/(\d+)\.(\d+)\.(\d+)/u);
  if (version_match === null) {
    return null;
  }

  return {
    major: Number(version_match[1]),
    minor: Number(version_match[2]),
    patch: Number(version_match[3]),
  };
}

// compare_semantic_version 封装当前模块的共享逻辑，避免重复实现同一维护规则。
function compare_semantic_version(left: SemanticVersion, right: SemanticVersion): number {
  if (left.major !== right.major) {
    return left.major - right.major;
  }

  if (left.minor !== right.minor) {
    return left.minor - right.minor;
  }

  return left.patch - right.patch;
}

// normalize_github_release_update 在边界处归一化输入，避免下游再处理坏载荷分支。
function normalize_github_release_update(
  payload: GithubReleasePayload,
  current_version: string,
): GithubReleaseUpdate | null {
  const current_semantic_version = parse_semantic_version(current_version);
  if (current_semantic_version === null) {
    return null;
  }

  if (typeof payload.tag_name !== "string" || typeof payload.html_url !== "string") {
    return null;
  }

  const latest_semantic_version = parse_semantic_version(payload.tag_name);
  const release_url = payload.html_url.trim();
  if (latest_semantic_version === null || release_url === "") {
    return null;
  }

  if (compare_semantic_version(latest_semantic_version, current_semantic_version) <= 0) {
    return null;
  }

  return {
    latest_version: `${latest_semantic_version.major}.${latest_semantic_version.minor}.${latest_semantic_version.patch}`,
    release_url,
  };
}

// probe_core_api_candidate 封装当前模块的共享逻辑，避免重复实现同一维护规则。
async function probe_core_api_candidate(base_url: string): Promise<CoreMetadata | null> {
  const abort_controller = new AbortController();
  const timeout_id = window.setTimeout(() => {
    abort_controller.abort();
  }, CORE_API_PROBE_TIMEOUT_MS);

  try {
    const response = await fetch(build_api_url(base_url, CORE_API_HEALTH_PATH), {
      method: "GET",
      signal: abort_controller.signal,
    });
    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as ApiEnvelope<HealthPayload>;
    if (payload.ok !== true || payload.data === undefined) {
      return null;
    }

    if (payload.data.status !== "ok") {
      return null;
    }

    if (payload.data.service !== CORE_API_SERVICE_NAME) {
      return null;
    }

    return normalize_core_metadata(payload.data);
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout_id);
  }
}

// resolve_core_api_base_url 集中解析运行时决策，避免调用点复制条件判断。
async function resolve_core_api_base_url(): Promise<string> {
  if (cached_core_api_base_url !== null) {
    return cached_core_api_base_url;
  }

  if (pending_core_api_base_url_resolution !== null) {
    return pending_core_api_base_url_resolution;
  }

  pending_core_api_base_url_resolution = (async () => {
    const base_url = read_core_api_base_url();
    const core_metadata = await probe_core_api_candidate(base_url);
    if (core_metadata !== null) {
      cached_core_api_base_url = base_url;
      cached_core_metadata = core_metadata;
      return base_url;
    }

    throw DesktopApiError.local("core_api_unavailable", 503);
  })();

  try {
    return await pending_core_api_base_url_resolution;
  } finally {
    pending_core_api_base_url_resolution = null;
  }
}

// get_core_metadata 封装当前模块的共享逻辑，避免重复实现同一维护规则。
export async function get_core_metadata(): Promise<CoreMetadata> {
  await resolve_core_api_base_url();
  if (cached_core_metadata === null) {
    throw DesktopApiError.local("core_metadata_unavailable", 503);
  }

  return cached_core_metadata;
}

// check_github_release_update 封装当前模块的共享逻辑，避免重复实现同一维护规则。
export async function check_github_release_update(
  current_version: string,
): Promise<GithubReleaseUpdate | null> {
  try {
    const response = await fetch(GITHUB_LATEST_RELEASE_URL, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
      },
    });
    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as GithubReleasePayload;
    return normalize_github_release_update(payload, current_version);
  } catch {
    return null;
  }
}

// api_fetch 封装当前模块的共享逻辑，避免重复实现同一维护规则。
export async function api_fetch<data_type>(
  path: string,
  body: Record<string, unknown> = {},
): Promise<data_type> {
  const base_url = await resolve_core_api_base_url();
  let response: Response;
  try {
    response = await fetch(build_api_url(base_url, path), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JsonTool.stringifyStrict(body),
    });
  } catch (error) {
    throw create_network_error(path, error);
  }
  const payload = await read_api_envelope<data_type>(response);

  if (!response.ok || payload?.ok !== true || payload.data === undefined) {
    throw build_desktop_api_error(path, response, payload);
  }

  return payload.data;
}

/**
 * renderer 诊断只通过公开 Core API 写日志，保持页面侧不直接接触 Node/Electron 日志能力。
 */
export async function report_renderer_error(report: RendererErrorReport): Promise<void> {
  await api_fetch<Record<string, never>>("/api/diagnostics/renderer-error", report);
}

// open_event_source_at_path 封装当前模块的共享逻辑，避免重复实现同一维护规则。
async function open_event_source_at_path(path: string): Promise<EventSource> {
  const base_url = await resolve_core_api_base_url();
  return new EventSource(build_api_url(base_url, path));
}

// open_event_stream 封装当前模块的共享逻辑，避免重复实现同一维护规则。
export async function open_event_stream(): Promise<EventSource> {
  return open_event_source_at_path("/api/events/stream");
}

// open_json_event_source_stream 封装当前模块的共享逻辑，避免重复实现同一维护规则。
async function* open_json_event_source_stream(args: {
  path: string;
  event_types: string[];
}): AsyncIterable<EventSourceJsonEvent> {
  const event_source = await open_event_source_at_path(args.path);
  const queue: EventSourceJsonEvent[] = [];
  let queue_read_index = 0;
  let pending_resolve: ((value: EventSourceJsonEvent | null) => void) | null = null;
  let stream_error: Error | null = null;
  let closed = false;

  // push_event 封装当前模块的共享逻辑，避免重复实现同一维护规则。
  function push_event(event: EventSourceJsonEvent): void {
    if (pending_resolve !== null) {
      const resolve = pending_resolve;
      pending_resolve = null;
      resolve(event);
      return;
    }

    queue.push(event);
  }

  // close_stream 封装当前模块的共享逻辑，避免重复实现同一维护规则。
  function close_stream(): void {
    if (closed) {
      return;
    }

    closed = true;
    event_source.close();
    if (pending_resolve !== null) {
      const resolve = pending_resolve;
      pending_resolve = null;
      resolve(null);
    }
  }

  // fail_stream 封装当前模块的共享逻辑，避免重复实现同一维护规则。
  function fail_stream(): void {
    stream_error = DesktopApiError.local("event_stream_failed", 503);
    close_stream();
  }

  for (const event_type of args.event_types) {
    event_source.addEventListener(event_type, ((event: MessageEvent<string>) => {
      const payload = parse_event_source_payload(event);
      push_event({
        type: event_type,
        ...payload,
      });
      if (event_type === "completed" || event_type === "failed") {
        close_stream();
      }
    }) as EventListener);
  }

  event_source.onerror = () => {
    fail_stream();
  };

  try {
    while (true) {
      // EventSource 短时积压时用游标读取，避免 shift 反复搬移数组
      if (queue_read_index < queue.length) {
        const next_event = queue[queue_read_index];
        queue_read_index += 1;
        if (queue_read_index >= queue.length) {
          queue.length = 0;
          queue_read_index = 0;
        }
        if (next_event !== undefined) {
          yield next_event;
          continue;
        }
      }

      if (closed) {
        if (stream_error !== null) {
          throw stream_error;
        }
        return;
      }

      const next_event = await new Promise<EventSourceJsonEvent | null>((resolve) => {
        pending_resolve = resolve;
      });

      if (next_event === null) {
        if (stream_error !== null) {
          throw stream_error;
        }
        return;
      }

      yield next_event;
    }
  } finally {
    close_stream();
  }
}

// 日志流只接受轻量事件字段，缺失预览契约时直接丢弃该条边界数据
function normalize_log_event(payload: EventSourceJsonEvent): LogEvent | null {
  if (typeof payload.id !== "string") {
    return null;
  }
  if (typeof payload.sequence !== "number") {
    return null;
  }
  if (typeof payload.created_at !== "string") {
    return null;
  }
  if (typeof payload.source !== "string") {
    return null;
  }
  if (typeof payload.message_preview !== "string") {
    return null;
  }
  if (typeof payload.message_length !== "number") {
    return null;
  }

  return {
    id: payload.id,
    sequence: payload.sequence,
    created_at: payload.created_at,
    level: normalize_log_level(payload.level),
    source: payload.source,
    message_preview: payload.message_preview,
    message_length: payload.message_length,
  };
}

/**
 * 日志详情是按需读取的完整正文，边界归一后才交给页面编辑器显示
 */
function normalize_log_detail(payload: unknown): LogDetail | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return null;
  }
  const detail = payload as Record<string, unknown>;
  if (
    typeof detail["id"] !== "string" ||
    typeof detail["sequence"] !== "number" ||
    typeof detail["created_at"] !== "string" ||
    typeof detail["source"] !== "string" ||
    typeof detail["message"] !== "string"
  ) {
    return null;
  }

  return {
    id: detail["id"],
    sequence: detail["sequence"],
    created_at: detail["created_at"],
    level: normalize_log_level(detail["level"]),
    source: detail["source"],
    message: detail["message"],
    error:
      typeof detail["error"] === "object" &&
      detail["error"] !== null &&
      !Array.isArray(detail["error"])
        ? normalize_log_error(detail["error"], "unknown_log_error")
        : undefined,
    context:
      typeof detail["context"] === "object" &&
      detail["context"] !== null &&
      !Array.isArray(detail["context"])
        ? { ...(detail["context"] as Record<string, unknown>) }
        : undefined,
  };
}

// open_log_stream 封装当前模块的共享逻辑，避免重复实现同一维护规则。
export async function* open_log_stream(): AsyncIterable<LogEvent> {
  for await (const event of open_json_event_source_stream({
    path: "/api/logs/stream",
    event_types: ["log.appended"],
  })) {
    const log_event = normalize_log_event(event);
    if (log_event !== null) {
      yield log_event;
    }
  }
}

/**
 * 读取当前进程内日志详情；详情被淘汰或载荷异常时统一返回 null
 */
export async function read_log_detail(id: string): Promise<LogDetail | null> {
  const payload = await api_fetch<{ detail?: unknown }>("/api/logs/detail", { id });
  return normalize_log_detail(payload.detail);
}

// open_external_url 封装当前模块的共享逻辑，避免重复实现同一维护规则。
export async function open_external_url(url: string): Promise<void> {
  const normalized_url = url.trim();

  if (normalized_url === "") {
    return;
  }

  await window.desktopApp.openExternalUrl(normalized_url);
}
