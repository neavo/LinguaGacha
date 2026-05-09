import { afterEach, describe, expect, it, vi } from "vitest";

import { CoreBridgeClient } from "./core-bridge-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CoreBridgeClient", () => {
  it("Python Core 返回错误壳时抛出公开错误消息", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(JSON.stringify({ ok: false, error: { message: "失败" } }), {
          headers: { "Content-Type": "application/json" },
          status: 500,
        });
      }),
    );
    const client = new CoreBridgeClient({
      pyCoreBaseUrl: "http://127.0.0.1:12345",
      pyCoreToken: "token",
    });

    await expect(client.start_translation({ mode: "NEW" })).rejects.toThrow("失败");
  });

  it("任务命令只调用内部 runtime task bridge", async () => {
    const fetch_mock = vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true, data: { accepted: true } }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetch_mock);
    const client = new CoreBridgeClient({
      pyCoreBaseUrl: "http://127.0.0.1:12345",
      pyCoreToken: "token",
    });

    await expect(client.start_translation({ mode: "NEW" })).resolves.toBeUndefined();

    expect(fetch_mock).toHaveBeenCalledWith(
      "http://127.0.0.1:12345/internal/runtime/tasks/start-translation",
      expect.objectContaining({
        body: JSON.stringify({ mode: "NEW" }),
        headers: {
          "Content-Type": "application/json",
          "X-LinguaGacha-Core-Token": "token",
        },
        method: "POST",
      }),
    );
  });
});
