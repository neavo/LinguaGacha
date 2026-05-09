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

    await expect(client.get_task_engine_state()).rejects.toThrow("失败");
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

  it("读取内部 Engine 任务状态并规范化重翻条目", async () => {
    stub_fetch({
      status: "RETRANSLATING",
      busy: true,
      request_in_flight_count: 3.8,
      active_task_type: "retranslate",
      retranslating_item_ids: [2, "1", 2, 0, "bad"],
    });
    const client = new CoreBridgeClient({
      pyCoreBaseUrl: "http://127.0.0.1:12345",
      pyCoreToken: "token",
    });

    await expect(client.get_task_engine_state()).resolves.toEqual({
      status: "RETRANSLATING",
      busy: true,
      request_in_flight_count: 3,
      active_task_type: "retranslate",
      retranslating_item_ids: [2, 1],
    });
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
