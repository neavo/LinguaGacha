import { JsonTool } from "../../../shared/utils/json-tool";
import { normalize_backend_api_base_url } from "@backend/api/api-base-url";
import {
  normalize_log_level,
  read_log_content,
  type LogDetail,
  type LogEvent,
  type LogLevel,
} from "@shared/log";
import {
  is_app_error_code,
  normalize_log_error,
  type ApiErrorPayload,
  type AppErrorCode,
  type RendererErrorReport,
} from "@shared/error";
import {
  select_windows_release_zip_urls,
  type WindowsReleaseZipUrls,
} from "@shared/update/windows-update-target";

export type { LogDetail, LogEvent, LogLevel };

type ApiEnvelope<data_type> = {
  ok: boolean;
  data?: data_type;
  error?: Partial<ApiErrorPayload>;
};

type GithubReleasePayload = {
  tag_name?: unknown;
  html_url?: unknown;
  assets?: unknown;
};

export type GithubReleaseUpdate = {
  latest_version: string; // GitHub release tag 归一出的三段式版本号
  release_url: string; // 自动更新不可用时交给 renderer 打开的发布页
  windows_zip_urls: WindowsReleaseZipUrls; // renderer 只保存 release 解析结果，目标架构由 main 判定
};

type SemanticVersion = {
  major: number;
  minor: number;
  patch: number;
};

export type DesktopLocalErrorCode =
  | "missing_backend_api_base_url"
  | "http_error"
  | "network_failed";

export type DesktopApiErrorCode = AppErrorCode | DesktopLocalErrorCode;

const GITHUB_LATEST_RELEASE_URL = "https://api.github.com/repos/neavo/LinguaGacha/releases/latest";

/**
 * 携带 Backend API 错误码，保持渲染层错误分支可判定
 */
export class DesktopApiError extends Error {
  public readonly code: DesktopApiErrorCode;
  public readonly details: Record<string, unknown>;

  /**
   * 初始化 DesktopApiError 依赖，保留 renderer 可判定的错误元数据
   */
  constructor(args: {
    code: DesktopApiErrorCode;
    details?: Record<string, unknown>;
    cause?: unknown;
  }) {
    super(args.code, args.cause === undefined ? undefined : { cause: args.cause });
    this.name = "DesktopApiError";
    this.code = args.code;
    this.details = args.details ?? {};
  }

  /**
   * 本地 renderer 错误使用同一类，避免页面判断 Error.message
   */
  public static local(
    code: DesktopLocalErrorCode,
    details: Record<string, unknown> = {},
  ): DesktopApiError {
    return new DesktopApiError({ code, details });
  }
}

/**
 * 从 Backend 响应壳构造统一 DesktopApiError。
 */
function build_desktop_api_error<data_type>(
  path: string,
  payload: ApiEnvelope<data_type> | null,
): DesktopApiError {
  const error = payload?.error;
  const code = is_app_error_code(error?.code) ? error.code : "http_error";
  return new DesktopApiError({
    code,
    details: error?.details ?? { path },
  });
}

async function read_api_envelope<data_type>(
  response: Response,
): Promise<ApiEnvelope<data_type> | null> {
  try {
    return (await response.json()) as ApiEnvelope<data_type>;
  } catch {
    return null;
  }
}

/**
 * 把 fetch 抛错归一为携带请求路径的本地网络错误。
 */
function create_network_error(path: string, cause: unknown): DesktopApiError {
  return new DesktopApiError({
    code: "network_failed",
    details: { path },
    cause,
  });
}

function read_backend_api_base_url(): string {
  const base_url = normalize_backend_api_base_url(window.desktopApp.backendApi.baseUrl);

  if (base_url === "") {
    throw DesktopApiError.local("missing_backend_api_base_url");
  }

  return base_url;
}

/**
 * 拼接 Backend API 绝对地址，并允许调用方传入有无斜杠的路径。
 */
function build_api_url(base_url: string, path: string): string {
  const normalized_path = path.startsWith("/") ? path : `/${path}`;
  return `${base_url}${normalized_path}`;
}

function parse_event_source_payload(event: MessageEvent<string>): Record<string, unknown> {
  try {
    return JsonTool.parseStrict<Record<string, unknown>>(event.data);
  } catch {
    return {};
  }
}

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

/**
 * 比较三段式版本号，返回值符号表达 left 相对 right 的新旧关系。
 */
function compare_semantic_version(left: SemanticVersion, right: SemanticVersion): number {
  if (left.major !== right.major) {
    return left.major - right.major;
  }

  if (left.minor !== right.minor) {
    return left.minor - right.minor;
  }

  return left.patch - right.patch;
}

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
    windows_zip_urls: select_windows_release_zip_urls(
      payload.assets,
      `${latest_semantic_version.major}.${latest_semantic_version.minor}.${latest_semantic_version.patch}`,
    ),
  };
}

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

/**
 * 通过统一 JSON envelope 提交 Backend POST 命令。
 */
export async function api_fetch<data_type>(
  path: string,
  body: Record<string, unknown> = {},
): Promise<data_type> {
  return api_request<data_type>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JsonTool.stringifyStrict(body),
  });
}

/**
 * 通过同一错误映射读取 Backend GET query。
 */
export async function api_get<data_type>(path: string): Promise<data_type> {
  return api_request<data_type>(path, { method: "GET" });
}

/**
 * 收口 Backend 请求、网络异常与公开错误 envelope，调用方只接收 data。
 */
async function api_request<data_type>(path: string, init: RequestInit): Promise<data_type> {
  const base_url = read_backend_api_base_url();
  let response: Response;
  try {
    response = await fetch(build_api_url(base_url, path), init);
  } catch (error) {
    throw create_network_error(path, error);
  }
  const payload = await read_api_envelope<data_type>(response);

  if (!response.ok || payload?.ok !== true || payload.data === undefined) {
    throw build_desktop_api_error(path, payload);
  }

  return payload.data;
}

/**
 * renderer 诊断只通过公开 Backend API 写日志，保持页面侧不直接接触 Node/Electron 日志能力。
 */
export async function report_renderer_error(report: RendererErrorReport): Promise<void> {
  await api_fetch<Record<string, never>>("/api/diagnostics/renderer-error", report);
}

function open_event_source_at_path(path: string): EventSource {
  return new EventSource(build_api_url(read_backend_api_base_url(), path));
}

/** 运行期地址已由 main 在 Backend ready 后注入，renderer 直接建立共享事件流。 */
export function open_event_stream(): EventSource {
  return open_event_source_at_path("/api/events/stream");
}

// 日志流只接受轻量事件字段，缺失预览契约时直接丢弃该条边界数据
function normalize_log_event(payload: Record<string, unknown>): LogEvent | null {
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
 * 日志详情是按需读取的结构化正文，边界归一后才交给页面显示
 */
function normalize_log_detail(payload: unknown): LogDetail | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return null;
  }
  const detail = payload as Record<string, unknown>;
  const content = read_log_content(detail["content"]);
  if (
    typeof detail["id"] !== "string" ||
    typeof detail["sequence"] !== "number" ||
    typeof detail["created_at"] !== "string" ||
    typeof detail["source"] !== "string" ||
    content === null
  ) {
    return null;
  }

  return {
    id: detail["id"],
    sequence: detail["sequence"],
    created_at: detail["created_at"],
    level: normalize_log_level(detail["level"]),
    source: detail["source"],
    content,
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

/** 日志页面只接收已收窄的轻量事件，连接重试由浏览器 EventSource 负责。 */
export function subscribe_log_stream(on_append: (event: LogEvent) => void): () => void {
  const event_source = open_event_source_at_path("/api/logs/stream");
  const handle_append = ((event: MessageEvent<string>) => {
    const log_event = normalize_log_event(parse_event_source_payload(event));
    if (log_event !== null) {
      on_append(log_event);
    }
  }) as EventListener;
  event_source.addEventListener("log.appended", handle_append);

  return () => {
    event_source.removeEventListener("log.appended", handle_append);
    event_source.close();
  };
}

/**
 * 读取当前进程内日志详情；详情被淘汰或载荷异常时统一返回 null
 */
export async function read_log_detail(id: string): Promise<LogDetail | null> {
  const payload = await api_fetch<{ detail?: unknown }>("/api/logs/detail", { id });
  return normalize_log_detail(payload.detail);
}

/** 外链不做应用级判断或改写，原样交给桌面宿主。 */
export async function open_external_url(url: string): Promise<void> {
  await window.desktopApp.openExternalUrl(url);
}
