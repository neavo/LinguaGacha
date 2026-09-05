import { afterEach, describe, expect, it, vi } from "vitest";

import {
  flush_worker_microtasks,
  install_worker_threads_mock,
} from "../../../test/worker-port-harness";
import type { PlanningWorkerIncomingMessage } from "./planning-worker-types";

// 入口文件有顶层订阅副作用，每个用例都必须在 mock 安装后动态导入。
async function import_worker_entry(): Promise<void> {
  await import("./planning-worker-entry");
}

describe("planning-worker-entry", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("node:worker_threads");
    vi.doUnmock("../core/token-counter");
  });

  it("收到 count_tokens 后按请求 id 回传 token 计数结果", async () => {
    const harness = install_worker_threads_mock<PlanningWorkerIncomingMessage>();
    const count = vi.fn((text: string) => text.length);
    vi.doMock("../core/token-counter", () => {
      return {
        create_o200k_base_token_counter: () => ({ count }),
      };
    });

    await import_worker_entry();

    harness.emit({
      id: "count-1",
      type: "count_tokens",
      items: [
        { cache_key: "row:1", text: "abc" },
        { cache_key: "row:2", text: "字幕" },
      ],
    });
    await flush_worker_microtasks();

    expect(count).toHaveBeenCalledWith("abc");
    expect(count).toHaveBeenCalledWith("字幕");
    expect(harness.postMessage).toHaveBeenCalledWith({
      id: "count-1",
      ok: true,
      data: [
        { cache_key: "row:1", token_count: 3 },
        { cache_key: "row:2", token_count: 2 },
      ],
    });
  });

  it("先收到 cancel 时会用结构化诊断回传取消失败", async () => {
    const harness = install_worker_threads_mock<PlanningWorkerIncomingMessage>();
    const count = vi.fn((text: string) => text.length);
    vi.doMock("../core/token-counter", () => {
      return {
        create_o200k_base_token_counter: () => ({ count }),
      };
    });

    await import_worker_entry();

    harness.emit({ id: "count-2", type: "cancel" });
    harness.emit({
      id: "count-2",
      type: "count_tokens",
      items: [{ cache_key: "row:1", text: "abc" }],
    });
    await flush_worker_microtasks();

    expect(count).not.toHaveBeenCalled();
    expect(harness.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "count-2",
        ok: false,
        error: expect.objectContaining({
          message: "Planning token counting was cancelled.",
          context: expect.objectContaining({
            worker_message_type: "count_tokens",
          }),
        }),
      }),
    );
  });
});
