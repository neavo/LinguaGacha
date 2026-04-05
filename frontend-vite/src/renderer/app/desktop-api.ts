type ApiEnvelope<data_type> = {
  ok: boolean
  data?: data_type
  error?: {
    code?: string
    message?: string
  }
}

type HealthPayload = {
  status?: string
  service?: string
}

const CORE_API_HEALTH_PATH = '/api/health'
const CORE_API_SERVICE_NAME = 'linguagacha-core'
const CORE_API_PROBE_TIMEOUT_MS = 300

let cached_core_api_base_url: string | null = null
let pending_core_api_base_url_resolution: Promise<string> | null = null

export class DesktopApiError extends Error {
  code: string
  status: number

  constructor(message: string, code = 'unknown_error', status = 500) {
    super(message)
    this.name = 'DesktopApiError'
    this.code = code
    this.status = status
  }
}

function normalize_base_url(base_url: string): string {
  return base_url.trim().replace(/\/+$/u, '')
}

function list_core_api_base_url_candidates(): string[] {
  return window.desktopApp.coreApi.baseUrlCandidates
    .map((base_url) => normalize_base_url(base_url))
    .filter((base_url) => base_url !== '')
}

function build_api_url(base_url: string, path: string): string {
  const normalized_path = path.startsWith('/') ? path : `/${path}`
  return `${base_url}${normalized_path}`
}

async function probe_core_api_candidate(base_url: string): Promise<boolean> {
  const abort_controller = new AbortController()
  const timeout_id = window.setTimeout(() => {
    abort_controller.abort()
  }, CORE_API_PROBE_TIMEOUT_MS)

  try {
    const response = await fetch(build_api_url(base_url, CORE_API_HEALTH_PATH), {
      method: 'GET',
      signal: abort_controller.signal,
    })
    if (!response.ok) {
      return false
    }

    const payload = await response.json() as ApiEnvelope<HealthPayload>
    if (payload.ok !== true || payload.data === undefined) {
      return false
    }

    if (payload.data.status !== 'ok') {
      return false
    }

    if (payload.data.service !== CORE_API_SERVICE_NAME) {
      return false
    }

    return true
  } catch {
    return false
  } finally {
    window.clearTimeout(timeout_id)
  }
}

async function resolve_core_api_base_url(): Promise<string> {
  if (cached_core_api_base_url !== null) {
    return cached_core_api_base_url
  }

  if (pending_core_api_base_url_resolution !== null) {
    return pending_core_api_base_url_resolution
  }

  const base_url_candidates = list_core_api_base_url_candidates()
  if (base_url_candidates.length === 0) {
    throw new DesktopApiError('Core API 地址未配置。', 'missing_core_api_base_url', 500)
  }

  pending_core_api_base_url_resolution = (async () => {
    for (const base_url of base_url_candidates) {
      const is_available = await probe_core_api_candidate(base_url)
      if (is_available) {
        cached_core_api_base_url = base_url
        return base_url
      }
    }

    throw new DesktopApiError('Core API 不可用。', 'core_api_unavailable', 503)
  })()

  try {
    return await pending_core_api_base_url_resolution
  } finally {
    pending_core_api_base_url_resolution = null
  }
}

export async function api_fetch<data_type>(
  path: string,
  body: Record<string, unknown> = {},
): Promise<data_type> {
  const base_url = await resolve_core_api_base_url()
  const response = await fetch(build_api_url(base_url, path), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const payload = await response.json() as ApiEnvelope<data_type>

  if (!response.ok || payload.ok !== true || payload.data === undefined) {
    const message = payload.error?.message ?? `请求失败：${path}`
    const code = payload.error?.code ?? 'http_error'
    throw new DesktopApiError(message, code, response.status)
  }

  return payload.data
}

export async function open_event_stream(): Promise<EventSource> {
  const base_url = await resolve_core_api_base_url()
  return new EventSource(build_api_url(base_url, '/api/events/stream'))
}
