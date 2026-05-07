const CORE_API_HEALTH_PATH = "/api/health";
const CORE_API_HEALTH_TIMEOUT_MS = 20_000;
const CORE_API_HEALTH_INTERVAL_MS = 250;
const CORE_API_HTTP_TIMEOUT_MS = 1_000;

interface CoreHealthResponse {
  ok?: boolean;
  data?: {
    status?: string;
    service?: string;
    instanceToken?: string;
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function fetch_core_health(base_url: string): Promise<CoreHealthResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, CORE_API_HTTP_TIMEOUT_MS);

  try {
    const response = await fetch(`${base_url}${CORE_API_HEALTH_PATH}`, {
      method: "GET",
      signal: controller.signal,
    });
    return (await response.json()) as CoreHealthResponse;
  } finally {
    clearTimeout(timeout);
  }
}

function assert_expected_health_response(
  response: CoreHealthResponse,
  instance_token: string,
): void {
  if (response.ok !== true) {
    throw new Error("Core API health 响应不是成功响应。");
  }
  if (response.data?.status !== "ok" || response.data.service !== "linguagacha-core") {
    throw new Error("Core API health 响应服务标识不匹配。");
  }
  if (response.data.instanceToken !== instance_token) {
    throw new Error("Core API health 响应实例令牌不匹配。");
  }
}

export async function wait_for_core_health(
  base_url: string,
  instance_token: string,
): Promise<void> {
  const started_at = Date.now();
  let last_error: unknown = null;

  while (Date.now() - started_at < CORE_API_HEALTH_TIMEOUT_MS) {
    try {
      const response = await fetch_core_health(base_url);
      assert_expected_health_response(response, instance_token);
      return;
    } catch (error) {
      last_error = error;
      await delay(CORE_API_HEALTH_INTERVAL_MS);
    }
  }

  const detail = last_error instanceof Error ? last_error.message : "未知错误";
  throw new Error(`等待 Python Core 健康检查超时：${detail}`);
}
