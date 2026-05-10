import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PythonTaskExecutorClient,
  PythonTaskExecutorTransportError,
} from "./python-task-executor-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PythonTaskExecutorClient", () => {
  it("调用 task-executor 窄路由并携带内部 token", async () => {
    const fetch_mock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          ok: true,
          data: { items: [{ id: 1, status: "PROCESSED" }], row_count: 1 },
        }),
        { headers: { "Content-Type": "application/json" }, status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetch_mock);
    const client = new PythonTaskExecutorClient({
      pyCoreBaseUrl: "http://127.0.0.1:12345",
      pyCoreToken: "token",
    });

    const result = await client.execute_translation_chunk(
      {
        run_id: "run",
        work_unit_id: "unit",
        task_type: "translation",
        model: {},
        config_snapshot: {},
        quality_snapshot: null,
      },
      new AbortController().signal,
    );

    expect(result.items).toEqual([{ id: 1, status: "PROCESSED" }]);
    expect(fetch_mock).toHaveBeenCalledWith(
      "http://127.0.0.1:12345/internal/task-executor/translation-chunk",
      expect.objectContaining({
        headers: {
          "Content-Type": "application/json",
          "X-LinguaGacha-Core-Token": "token",
        },
        method: "POST",
      }),
    );
  });

  it("Python 返回错误壳时抛出公开错误消息", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(JSON.stringify({ ok: false, error: { message: "失败" } }), {
          headers: { "Content-Type": "application/json" },
          status: 500,
        });
      }),
    );
    const client = new PythonTaskExecutorClient({
      pyCoreBaseUrl: "http://127.0.0.1:12345",
      pyCoreToken: "token",
    });

    await expect(
      client.execute_analysis_chunk(
        {
          run_id: "run",
          work_unit_id: "unit",
          task_type: "analysis",
          model: {},
          config_snapshot: {},
          quality_snapshot: null,
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow("失败");
  });

  it("网络失败时抛出可识别的传输错误", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const client = new PythonTaskExecutorClient({
      pyCoreBaseUrl: "http://127.0.0.1:12345",
      pyCoreToken: "token",
    });

    await expect(
      client.execute_translation_chunk(
        {
          run_id: "run",
          work_unit_id: "unit",
          task_type: "translation",
          model: {},
          config_snapshot: {},
          quality_snapshot: null,
        },
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(PythonTaskExecutorTransportError);
  });
});
