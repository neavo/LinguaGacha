import { AsyncLocalStorage } from "node:async_hooks";

interface HttpResponseInfo {
  http_status?: number;
  http_received_at?: number; // 响应接收时间，毫秒，用于固定本次冷却起点。
  retry_after_ms?: number; // 有效 `Retry-After` 相对接收时刻的等待长度。
}

const response_info = new AsyncLocalStorage<HttpResponseInfo>(); // 每次请求独立采集，SDK 的异步调用沿用所属上下文。

/** SDK 会把 HTTP 错误压成文本，此处在同一异步调用链中保留响应事实。 */
export async function with_http_response_info<T extends object>(
  operation: () => Promise<T>,
): Promise<T & HttpResponseInfo> {
  const observation: HttpResponseInfo = {};
  return response_info.run(observation, async () => {
    const value = await operation();
    return { ...value, ...observation };
  });
}

/** 普通 HTTP 入口仅记录事实，调用者决定状态码的业务含义。 */
export function record_http_response_info(response: Pick<Response, "status" | "headers">): void {
  const observation = response_info.getStore();
  if (observation === undefined) return;
  const received_at = Date.now();
  const raw = response.headers.get("retry-after")?.trim();
  const delay =
    raw === undefined || raw === ""
      ? NaN
      : /^\d+$/.test(raw)
        ? Number(raw) * 1000
        : /^(?:[A-Za-z]{3,9}, |[A-Za-z]{3} )/.test(raw)
          ? Date.parse(raw) - received_at
          : NaN;
  observation.http_status = response.status;
  observation.http_received_at = received_at;
  // 同次响应覆盖整组事实，避免后续响应沿用上一响应的等待时间。
  if (Number.isFinite(delay) && delay > 0) observation.retry_after_ms = delay;
  else delete observation.retry_after_ms;
}
