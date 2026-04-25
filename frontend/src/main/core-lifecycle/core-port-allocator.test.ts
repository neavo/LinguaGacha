import net from "node:net";

import { describe, expect, it } from "vitest";

import {
  CORE_API_HOST,
  allocate_core_api_port,
  build_core_api_base_url,
} from "./core-port-allocator";

describe("core-port-allocator", () => {
  it("生成固定回环地址的 Core API base URL", () => {
    expect(build_core_api_base_url(38191)).toBe("http://127.0.0.1:38191");
  });

  it("分配可重新绑定的本地端口", async () => {
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

    expect(port).toBeGreaterThan(0);
  });
});
