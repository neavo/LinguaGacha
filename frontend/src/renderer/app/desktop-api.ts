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
};

type EventSourceJsonEvent = {
  type: string;
  [key: string]: unknown;
};

const CORE_API_HEALTH_PATH = "/api/health";
const CORE_API_SERVICE_NAME = "linguagacha-core";
const CORE_API_PROBE_TIMEOUT_MS = 300;

let cached_core_api_base_url: string | null = null;
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

async function probe_core_api_candidate(base_url: string): Promise<boolean> {
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
      return false;
    }

    const payload = (await response.json()) as ApiEnvelope<HealthPayload>;
    if (payload.ok !== true || payload.data === undefined) {
      return false;
    }

    if (payload.data.status !== "ok") {
      return false;
    }

    if (payload.data.service !== CORE_API_SERVICE_NAME) {
      return false;
    }

    return true;
  } catch {
    return false;
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
    const is_available = await probe_core_api_candidate(base_url);
    if (is_available) {
      cached_core_api_base_url = base_url;
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

export async function open_external_url(url: string): Promise<void> {
  const normalized_url = url.trim();

  if (normalized_url === "") {
    return;
  }

  await window.desktopApp.openExternalUrl(normalized_url);
}
