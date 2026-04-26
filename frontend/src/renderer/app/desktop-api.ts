type ApiEnvelope<data_type> = {
  ok: boolean;
  data?: data_type;
  error?: {
    code?: string;
    message?: string;
  };
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

export type LogLevel = "debug" | "info" | "warning" | "error" | "fatal";

export type LogEvent = {
  id: string;
  sequence: number;
  created_at: string;
  level: LogLevel;
  message: string;
};

type SemanticVersion = {
  major: number;
  minor: number;
  patch: number;
};

const CORE_API_HEALTH_PATH = "/api/health";
const CORE_API_SERVICE_NAME = "linguagacha-core";
const CORE_API_PROBE_TIMEOUT_MS = 300;
const GITHUB_LATEST_RELEASE_URL = "https://api.github.com/repos/neavo/LinguaGacha/releases/latest";

let cached_core_api_base_url: string | null = null;
let cached_core_metadata: CoreMetadata | null = null;
let pending_core_api_base_url_resolution: Promise<string> | null = null;

export class DesktopApiError extends Error {
  code: string;
  status: number;

  constructor(message: string, code = "unknown_error", status = 500) {
    super(message);
    this.name = "DesktopApiError";
    this.code = code;
    this.status = status;
  }
}

function normalize_base_url(base_url: string): string {
  return base_url.trim().replace(/\/+$/u, "");
}

function read_core_api_base_url(): string {
  const base_url = normalize_base_url(window.desktopApp.coreApi.baseUrl);

  if (base_url === "") {
    throw new DesktopApiError("Core API 地址未配置。", "missing_core_api_base_url", 500);
  }

  return base_url;
}

function build_api_url(base_url: string, path: string): string {
  const normalized_path = path.startsWith("/") ? path : `/${path}`;
  return `${base_url}${normalized_path}`;
}

function parse_event_source_payload(event: MessageEvent<string>): Record<string, unknown> {
  try {
    return JSON.parse(event.data) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function normalize_core_metadata(payload: HealthPayload): CoreMetadata | null {
  const version = payload.version?.trim();
  if (version === undefined || version === "") {
    return null;
  }

  return { version };
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
  };
}

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

    throw new DesktopApiError("Core API 不可用。", "core_api_unavailable", 503);
  })();

  try {
    return await pending_core_api_base_url_resolution;
  } finally {
    pending_core_api_base_url_resolution = null;
  }
}

export async function get_core_metadata(): Promise<CoreMetadata> {
  await resolve_core_api_base_url();
  if (cached_core_metadata === null) {
    throw new DesktopApiError("Core 元信息不可用。", "core_metadata_unavailable", 503);
  }

  return cached_core_metadata;
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

export async function api_fetch<data_type>(
  path: string,
  body: Record<string, unknown> = {},
): Promise<data_type> {
  const base_url = await resolve_core_api_base_url();
  const response = await fetch(build_api_url(base_url, path), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as ApiEnvelope<data_type>;

  if (!response.ok || payload.ok !== true || payload.data === undefined) {
    const message = payload.error?.message ?? `请求失败：${path}`;
    const code = payload.error?.code ?? "http_error";
    throw new DesktopApiError(message, code, response.status);
  }

  return payload.data;
}

async function open_event_source_at_path(path: string): Promise<EventSource> {
  const base_url = await resolve_core_api_base_url();
  return new EventSource(build_api_url(base_url, path));
}

export async function open_event_stream(): Promise<EventSource> {
  return open_event_source_at_path("/api/events/stream");
}

async function* open_json_event_source_stream(args: {
  path: string;
  event_types: string[];
}): AsyncIterable<EventSourceJsonEvent> {
  const event_source = await open_event_source_at_path(args.path);
  const queue: EventSourceJsonEvent[] = [];
  let pending_resolve: ((value: EventSourceJsonEvent | null) => void) | null = null;
  let stream_error: Error | null = null;
  let closed = false;

  function push_event(event: EventSourceJsonEvent): void {
    if (pending_resolve !== null) {
      const resolve = pending_resolve;
      pending_resolve = null;
      resolve(event);
      return;
    }

    queue.push(event);
  }

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

  function fail_stream(): void {
    stream_error = new DesktopApiError("事件流连接失败。", "event_stream_failed", 503);
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
      if (queue.length > 0) {
        const next_event = queue.shift();
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

export function open_project_bootstrap_stream(): AsyncIterable<EventSourceJsonEvent> {
  return open_json_event_source_stream({
    path: "/api/project/bootstrap/stream",
    event_types: ["stage_started", "stage_payload", "stage_completed", "completed", "failed"],
  });
}

function normalize_log_level(value: unknown): LogLevel {
  if (
    value === "debug" ||
    value === "info" ||
    value === "warning" ||
    value === "error" ||
    value === "fatal"
  ) {
    return value;
  }

  return "info";
}

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
  if (typeof payload.message !== "string") {
    return null;
  }

  return {
    id: payload.id,
    sequence: payload.sequence,
    created_at: payload.created_at,
    level: normalize_log_level(payload.level),
    message: payload.message,
  };
}

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

export async function open_external_url(url: string): Promise<void> {
  const normalized_url = url.trim();

  if (normalized_url === "") {
    return;
  }

  await window.desktopApp.openExternalUrl(normalized_url);
}
