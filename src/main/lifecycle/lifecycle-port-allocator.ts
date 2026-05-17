import crypto from "node:crypto";
import net from "node:net";

import { CORE_API_HOST } from "../../native/core-api-endpoint";
import { RuntimeCapabilityMissingError } from "../../shared/error";

export { CORE_API_HOST, build_core_api_base_url } from "../../native/core-api-endpoint";

export const CORE_API_PORT_MIN = 49_152;
export const CORE_API_PORT_MAX = 65_535;
const CORE_API_PORT_ALLOCATION_MAX_ATTEMPTS = 128;

export interface CoreApiPortAllocationOptions {
  maxAttempts?: number;
  pickPort?: () => number;
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
          reject(
            new RuntimeCapabilityMissingError({
              public_details: { capability: "core_api_port" },
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

  throw new RuntimeCapabilityMissingError({
    public_details: { capability: "core_api_port" },
    diagnostic_context: {
      max_attempts,
      port_min: CORE_API_PORT_MIN,
      port_max: CORE_API_PORT_MAX,
      reason: "exhausted_retryable_ports",
    },
    cause: last_error,
  });
}
