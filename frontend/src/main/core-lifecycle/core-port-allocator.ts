import crypto from "node:crypto";
import net from "node:net";

export const CORE_API_HOST = "127.0.0.1";
export const CORE_API_PORT_MIN = 49_152;
export const CORE_API_PORT_MAX = 65_535;
const CORE_API_PORT_ALLOCATION_MAX_ATTEMPTS = 128;

export interface CoreApiPortAllocationOptions {
  maxAttempts?: number;
  pickPort?: () => number;
}

export function build_core_api_base_url(port: number): string {
  return `http://${CORE_API_HOST}:${port.toString()}`;
}

function pick_high_core_api_port(): number {
  return crypto.randomInt(CORE_API_PORT_MIN, CORE_API_PORT_MAX + 1);
}

function is_bind_failure_retryable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "EADDRINUSE"
  );
}

async function assert_port_bindable(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once("error", reject);
    server.listen(port, CORE_API_HOST, () => {
      const address = server.address();

      if (address === null || typeof address === "string") {
        server.close(() => {
          reject(new Error("无法分配 Core API 本地端口。"));
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

export async function allocate_core_api_port(
  options: CoreApiPortAllocationOptions = {},
): Promise<number> {
  const max_attempts = options.maxAttempts ?? CORE_API_PORT_ALLOCATION_MAX_ATTEMPTS;
  const pick_port = options.pickPort ?? pick_high_core_api_port;
  let last_error: unknown = null;

  for (let attempt = 0; attempt < max_attempts; attempt += 1) {
    const candidate_port = pick_port();
    try {
      await assert_port_bindable(candidate_port);
      return candidate_port;
    } catch (error) {
      if (!is_bind_failure_retryable(error)) {
        throw error;
      }
      last_error = error;
    }
  }

  const detail = last_error instanceof Error ? last_error.message : "未知错误";
  throw new Error(`无法在高位端口范围内分配 Core API 本地端口：${detail}`);
}
