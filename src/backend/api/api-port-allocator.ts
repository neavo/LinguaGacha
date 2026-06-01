import crypto from "node:crypto";
import net from "node:net";

import { BACKEND_API_HOST } from "./api-base-url";
import { RuntimeCapabilityMissingError } from "../../shared/error";

export { BACKEND_API_HOST, build_backend_api_base_url } from "./api-base-url";

export const BACKEND_API_PORT_MIN = 49_152;
export const BACKEND_API_PORT_MAX = 65_535;
const BACKEND_API_PORT_ALLOCATION_MAX_ATTEMPTS = 128;

export interface BackendApiPortAllocationOptions {
  assertPortBindable?: (port: number) => Promise<void>; // 测试可替换端口探测，生产路径仍使用真实 TCP 绑定
  maxAttempts?: number;
  pickPort?: () => number;
}

/**
 * 从动态高位端口区间随机选择 Backend API 候选端口。
 */
function pick_high_backend_api_port(): number {
  return crypto.randomInt(BACKEND_API_PORT_MIN, BACKEND_API_PORT_MAX + 1);
}

/**
 * 判断端口绑定失败是否适合换一个候选端口继续尝试。
 */
function is_bind_failure_retryable(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }

  const code = (error as { code?: unknown }).code;
  return code === "EADDRINUSE" || code === "EACCES";
}

/**
 * 用真实 TCP 监听确认候选端口可被后续 Gateway 重新绑定。
 */
async function assert_port_bindable(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once("error", reject);
    server.listen(port, BACKEND_API_HOST, () => {
      const address = server.address();

      if (address === null || typeof address === "string") {
        server.close(() => {
          reject(
            new RuntimeCapabilityMissingError({
              public_details: { capability: "backend_api_port" },
              diagnostic_context: { reason: "unexpected_server_address", port },
            }),
          );
        });
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  });
}

/**
 * 分配可绑定的 Backend API 端口，遇到占用或系统拒绝的候选端口时继续重试。
 */
export async function allocate_backend_api_port(
  options: BackendApiPortAllocationOptions = {},
): Promise<number> {
  const max_attempts = options.maxAttempts ?? BACKEND_API_PORT_ALLOCATION_MAX_ATTEMPTS;
  const pick_port = options.pickPort ?? pick_high_backend_api_port;
  const assert_port_available = options.assertPortBindable ?? assert_port_bindable;
  let last_error: unknown = null;

  for (let attempt = 0; attempt < max_attempts; attempt += 1) {
    const candidate_port = pick_port();
    try {
      await assert_port_available(candidate_port);
      return candidate_port;
    } catch (error) {
      if (!is_bind_failure_retryable(error)) {
        throw error;
      }
      last_error = error;
    }
  }

  throw new RuntimeCapabilityMissingError({
    public_details: { capability: "backend_api_port" },
    diagnostic_context: {
      max_attempts,
      port_min: BACKEND_API_PORT_MIN,
      port_max: BACKEND_API_PORT_MAX,
      reason: "exhausted_retryable_ports",
    },
    cause: last_error,
  });
}
