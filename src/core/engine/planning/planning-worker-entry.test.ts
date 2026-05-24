import { afterEach, describe, expect, it, vi } from "vitest";

import type { PlanningWorkerIncomingMessage } from "./planning-worker-types";

// WorkerPortHarness 保存入口订阅和回包 spy，测试通过 emit 模拟主线程消息。
type WorkerPortHarness = {
  listener: ((message: PlanningWorkerIncomingMessage) => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
  emit: (message: PlanningWorkerIncomingMessage) => void;
};

// harness 模拟 worker_threads 的最小 parentPort，保证测试只覆盖入口协议。
function install_worker_threads_mock(): WorkerPortHarness {
  const harness: WorkerPortHarness = {
    listener: null,
    postMessage: vi.fn(),
    // emit 模拟测试场景中的对应运行时方法，保持断言聚焦协议行为。
    emit(message) {
      harness.listener?.(message);
    },
  };

  const parent_port = {
    on: vi.fn((event_name: string, listener: (message: PlanningWorkerIncomingMessage) => void) => {
      if (event_name === "message") {
        harness.listener = listener;
      }
    }),
    postMessage: harness.postMessage,
  };

  vi.doMock("node:worker_threads", () => {
    return {
      default: {
        parentPort: parent_port,
      },
      parentPort: parent_port,
    };
  });

  return harness;
}

// 入口文件有顶层订阅副作用，每个用例都必须在 mock 安装后动态导入。
async function import_worker_entry(): Promise<void> {
  await import("./planning-worker-entry");
}

// worker 入口把异步错误压回 postMessage，测试需等待内部 Promise 收尾。
async function flush_worker_microtasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("planning-worker-entry", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("node:worker_threads");
    vi.doUnmock("../core/token-counter");
  });

  it("收到 count_tokens 后按请求 id 回传 token 计数结果", async () => {
    const harness = install_worker_threads_mock();
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
    const harness = install_worker_threads_mock();
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
        error_diagnostic: expect.objectContaining({
          message: "规划 token 计数已取消。",
          context: expect.objectContaining({
            worker_message_type: "count_tokens",
          }),
        }),
      }),
    );
  });
});
