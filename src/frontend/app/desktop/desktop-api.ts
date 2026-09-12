import { JsonTool } from "../../../shared/utils/json-tool";
import { normalize_backend_api_base_url } from "@backend/api/api-base-url";
import {
  normalize_log_level,
  read_log_content,
  type LogDetail,
  type LogEntry,
  type LogLevel,
  type LogCursor,
  type LogPage,
  type LogPageRequest,
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

export type { LogDetail, LogEntry, LogLevel };

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

/** 响应不是合法 JSON 时交由统一错误映射处理。 */
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

/** 只消费宿主注入的地址，缺失时报告本地接入错误。 */
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

/** 提取三段版本用于更新比较，不参与展示文案。 */
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

/** 收窄发布元数据，保留下载选择所需的有效资产。 */
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

/** 通过现有网络入口读取并比较最新发布版本。 */
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
  signal?: AbortSignal,
): Promise<data_type> {
  return api_request<data_type>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JsonTool.stringifyStrict(body),
    signal,
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

/** 从同一后端地址建立页面事件流。 */
function open_event_source_at_path(path: string): EventSource {
  return new EventSource(build_api_url(read_backend_api_base_url(), path));
}

/** 运行期地址已由 main 在 Backend ready 后注入，renderer 直接建立共享事件流。 */
export function open_event_stream(): EventSource {
  return open_event_source_at_path("/api/events/stream");
}

// 日志流只接受轻量事件字段，缺失预览契约时直接丢弃该条边界数据
function normalize_log_entry(payload: Record<string, unknown>): LogEntry | null {
  if (!read_log_identity(payload)) {
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
    date: payload.date,
    line: payload.line,
    revision: payload.revision,
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
    !read_log_identity(detail) ||
    typeof detail["created_at"] !== "string" ||
    typeof detail["source"] !== "string" ||
    content === null
  ) {
    return null;
  }

  return {
    id: detail["id"],
    date: detail["date"],
    line: detail["line"],
    revision: detail["revision"],
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

/** 物理行号属于记录身份，内容代次属于文件有效性，两者独立校验。 */
function read_log_identity(
  value: Record<string, unknown>,
): value is Record<string, unknown> & Pick<LogEntry, "id" | "date" | "line" | "revision"> {
  return (
    typeof value.date === "string" &&
    /^\d{8}$/.test(value.date) &&
    typeof value.line === "number" &&
    Number.isSafeInteger(value.line) &&
    value.line > 0 &&
    typeof value.revision === "string" &&
    value.revision !== "" &&
    value.id === `${value.date}:${String(value.line)}`
  );
}

/** 收窄日期、行数和内容代次，拒绝失真的分页边界。 */
function read_cursor(value: unknown): LogCursor | null {
  if (value === null) return null;
  if (typeof value !== "object") throw new Error("Invalid log cursor");
  const cursor = value as Record<string, unknown>;
  if (
    typeof cursor.date !== "string" ||
    !/^\d{8}$/.test(cursor.date) ||
    typeof cursor.line !== "number" ||
    !Number.isSafeInteger(cursor.line) ||
    cursor.line < 0 ||
    typeof cursor.revision !== "string" ||
    cursor.revision === ""
  )
    throw new Error("Invalid log cursor");
  return { date: cursor.date, line: cursor.line, revision: cursor.revision };
}

/** 只接受后端返回的有效日期列表。 */
export async function read_log_dates(signal?: AbortSignal): Promise<string[]> {
  const result = await api_fetch<{ dates: unknown }>("/api/logs/files", {}, signal);
  if (
    !Array.isArray(result.dates) ||
    !result.dates.every((date: unknown) => typeof date === "string" && /^\d{8}$/.test(date))
  )
    throw new Error("Invalid log dates");
  return result.dates as string[];
}

/** 收窄完整分页响应，避免异常摘要进入页面缓存。 */
export async function read_log_page(
  request: LogPageRequest,
  signal?: AbortSignal,
): Promise<LogPage> {
  const result = await api_fetch<Record<string, unknown>>("/api/logs/page", { ...request }, signal);
  if (
    !["ready", "expired", "cursor_invalid"].includes(String(result.status)) ||
    !Array.isArray(result.entries) ||
    typeof result.has_more !== "boolean"
  )
    throw new Error("Invalid log page");
  const entries = result.entries.map((value: unknown) =>
    typeof value === "object" && value !== null
      ? normalize_log_entry(value as Record<string, unknown>)
      : null,
  );
  if (entries.some((entry) => entry === null)) throw new Error("Invalid log entry");
  return {
    status: result.status as LogPage["status"],
    entries: entries as LogEntry[],
    before: read_cursor(result.before),
    after: read_cursor(result.after),
    has_more: result.has_more,
  };
}

/** 详情直接从正文文件读取，不依赖当前进程是否曾显示该记录。 */
export async function read_log_detail(
  id: string,
  revision: string,
  signal?: AbortSignal,
): Promise<LogDetail | null> {
  const payload = await api_fetch<{ detail?: unknown }>(
    "/api/logs/detail",
    { id, revision },
    signal,
  );
  return normalize_log_detail(payload.detail);
}

/** 外链不做应用级判断或改写，原样交给桌面宿主。 */
export async function open_external_url(url: string): Promise<void> {
  await window.desktopApp.openExternalUrl(url);
}
