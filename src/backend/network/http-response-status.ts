import { AsyncLocalStorage } from "node:async_hooks";

const response_status = new AsyncLocalStorage<{ status?: number }>(); // 每次请求独立采集，SDK 的异步调用沿用所属上下文。

/** SDK 可能将 HTTP 错误压成文本；在同一异步调用链中保留原始状态码。 */
export async function with_http_response_status<T extends object>(
  operation: () => Promise<T>,
): Promise<T & { http_status?: number }> {
  const observation: { status?: number } = {};
  return response_status.run(observation, async () => {
    const value = await operation();
    return observation.status === undefined ? value : { ...value, http_status: observation.status };
  });
}

/** 普通 HTTP 入口仅记录事实，调用者决定状态码的业务含义。 */
export function record_http_response_status(status: number): void {
  const observation = response_status.getStore();
  if (observation !== undefined) observation.status = status;
}
