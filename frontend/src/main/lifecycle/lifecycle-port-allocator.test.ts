import net from "node:net";

import { describe, expect, it } from "vitest";

import {
  CORE_API_HOST,
  CORE_API_PORT_MAX,
  CORE_API_PORT_MIN,
  allocate_core_api_port,
  build_core_api_base_url,
} from "./lifecycle-port-allocator";

async function listen_on_port(port: number): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(port, CORE_API_HOST, () => {
      resolve(server);
    });
  });
}

function read_listening_port(server: net.Server): number {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("测试服务器没有可读取的 TCP 端口。");
  }

  return address.port;
}

async function close_server(server: net.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

async function reserve_then_release_port(): Promise<number> {
  const server = await listen_on_port(0);
  const port = read_listening_port(server);
  await close_server(server);
  return port;
}

describe("lifecycle-port-allocator", () => {
  it("生成固定回环地址的 Core API base URL", () => {
    expect(build_core_api_base_url(38191)).toBe("http://127.0.0.1:38191");
  });

  it("分配高位范围内可重新绑定的本地端口", async () => {
    const port = await allocate_core_api_port();

    await new Promise<void>((resolve, reject) => {
      const server = net.createServer();
      server.once("error", reject);
      server.listen(port, CORE_API_HOST, () => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    });

    expect(port).toBeGreaterThanOrEqual(CORE_API_PORT_MIN);
    expect(port).toBeLessThanOrEqual(CORE_API_PORT_MAX);
  });

  it("候选端口被占用时继续尝试后续端口", async () => {
    const occupied_server = await listen_on_port(0);
    const occupied_port = read_listening_port(occupied_server);
    let fallback_port = await reserve_then_release_port();
    while (fallback_port === occupied_port) {
      fallback_port = await reserve_then_release_port();
    }

    try {
      const picked_ports = [occupied_port, fallback_port];
      const port = await allocate_core_api_port({
        pickPort: () => picked_ports.shift() ?? fallback_port,
      });

      expect(port).toBe(fallback_port);
    } finally {
      await close_server(occupied_server);
    }
  });

  it("候选次数耗尽时给出清晰错误", async () => {
    const occupied_server = await listen_on_port(0);
    const occupied_port = read_listening_port(occupied_server);

    try {
      await expect(
        allocate_core_api_port({
          maxAttempts: 2,
          pickPort: () => occupied_port,
        }),
      ).rejects.toThrow("无法在高位端口范围内分配 Core API 本地端口");
    } finally {
      await close_server(occupied_server);
    }
  });
});
