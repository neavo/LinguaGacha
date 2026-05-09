import { afterEach, describe, expect, it, vi } from "vitest";

import { CoreBridgeClient } from "./core-bridge-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stub_fetch(data: Record<string, unknown>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true, data }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }),
  );
}

describe("CoreBridgeClient", () => {
  it("读取 Python 内部项目状态并规范化缺失字段", async () => {
    stub_fetch({ loaded: true, busy: true });
    const client = new CoreBridgeClient({
      pyCoreBaseUrl: "http://127.0.0.1:12345",
      pyCoreToken: "token",
    });

    await expect(client.get_project_state()).resolves.toEqual({
      loaded: true,
      projectPath: "",
      busy: true,
    });
  });

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

    await expect(client.get_task_snapshot()).rejects.toThrow("失败");
  });

  it("加载工程只通过内部 runtime sync 提交 project_load", async () => {
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

    await expect(client.load_project("E:/Project/demo.lg")).resolves.toBeUndefined();

    expect(fetch_mock).toHaveBeenCalledWith(
      "http://127.0.0.1:12345/internal/runtime/sync",
      expect.objectContaining({
        body: JSON.stringify({
          type: "project_load",
          payload: { project_path: "E:/Project/demo.lg" },
        }),
        headers: {
          "Content-Type": "application/json",
          "X-LinguaGacha-Core-Token": "token",
        },
        method: "POST",
      }),
    );
  });
});
