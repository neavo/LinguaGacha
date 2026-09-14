import { afterEach, describe, expect, it, vi } from "vitest";
import {
  flush_worker_microtasks,
  install_worker_threads_mock,
} from "../../../test/worker-port-harness";
import type { PlanningWorkerIncomingMessage } from "./planning-worker-types";

describe("planning-worker-entry", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("node:worker_threads");
    vi.doUnmock("./token-counter");
  });

  it("返回同序计数，取消活动批次后可以接收下一批", async () => {
    const harness = install_worker_threads_mock<PlanningWorkerIncomingMessage>();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.doMock("./token-counter", () => ({
      count_token_batch: async (texts: readonly string[], signal: AbortSignal) => {
        await gate;
        signal.throwIfAborted();
        return texts.map((text) => text.length);
      },
    }));
    await import("./planning-worker-entry");
    harness.emit({ id: 1, type: "count_tokens", texts: ["源文"] });
    harness.emit({ id: 1, type: "cancel" });
    release();
    await flush_worker_microtasks();
    expect(harness.postMessage).toHaveBeenCalledWith({ id: 1, status: "cancelled" });
    harness.emit({ id: 2, type: "count_tokens", texts: ["abc", "源文"] });
    await flush_worker_microtasks();
    expect(harness.postMessage).toHaveBeenCalledWith({ id: 2, status: "done", counts: [3, 2] });
  });

  it("计数异常保留结构化诊断", async () => {
    const harness = install_worker_threads_mock<PlanningWorkerIncomingMessage>();
    vi.doMock("./token-counter", () => ({
      count_token_batch: async () => {
        throw new Error("count failed");
      },
    }));
    await import("./planning-worker-entry");
    harness.emit({ id: 1, type: "count_tokens", texts: ["源文"] });
    await flush_worker_microtasks();
    expect(harness.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
        status: "error",
        error: expect.objectContaining({ message: "count failed" }),
      }),
    );
  });
});
