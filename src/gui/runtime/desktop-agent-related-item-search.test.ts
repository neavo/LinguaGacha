import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentRelatedItemSearchResult } from "../../shared/backend-runtime";
import {
  DesktopAgentRelatedItemSearch,
  type RelatedItemSearchWorkerIncomingMessage,
} from "./desktop-agent-related-item-search";
import type { RelatedItemSearchWorkerInput } from "./desktop-agent-related-item-search-worker";

const worker_mocks = vi.hoisted(() => {
  /** 只模拟门面依赖的 Worker 消息与生命周期，不执行索引逻辑。 */
  class FakeWorker {
    public static readonly instances: FakeWorker[] = [];
    public readonly messages: unknown[] = [];
    public readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    public terminated = false;

    public constructor(public readonly entry: URL) {
      FakeWorker.instances.push(this);
    }

    public on(event: string, listener: (...args: unknown[]) => void): this {
      const listeners = this.listeners.get(event) ?? [];
      listeners.push(listener);
      this.listeners.set(event, listeners);
      return this;
    }

    public postMessage(message: unknown): void {
      this.messages.push(message);
    }

    public async terminate(): Promise<number> {
      this.terminated = true;
      return 0;
    }

    public emit(event: string, ...args: unknown[]): void {
      for (const listener of this.listeners.get(event) ?? []) listener(...args);
    }
  }

  return { FakeWorker };
});

vi.mock("node:worker_threads", () => ({
  default: { Worker: worker_mocks.FakeWorker },
  Worker: worker_mocks.FakeWorker,
}));

const INPUT: RelatedItemSearchWorkerInput = {
  workspacePath: "E:/workspace/current",
  indexPath: "E:/workspace/related-item-search/index.sqlite",
  request: {
    queries: [{ key: "dryer", text: "靴乾燥機" }],
    file_paths: [],
    limit: 5,
    context_items: 2,
  },
};

const RESULT: AgentRelatedItemSearchResult = {
  indexed_item_count: 1,
  queries: [{ key: "dryer", results: [] }],
};

beforeEach(() => {
  worker_mocks.FakeWorker.instances.length = 0;
});

describe("DesktopAgentRelatedItemSearch", () => {
  it("首次搜索创建 worker，并按请求 id 结算对应结果", async () => {
    const search = new DesktopAgentRelatedItemSearch(new URL("file:///search-worker.js"));
    const pending = search.search(INPUT, new AbortController().signal);
    const worker = worker_mocks.FakeWorker.instances[0]!;
    const message = worker.messages[0] as Extract<
      RelatedItemSearchWorkerIncomingMessage,
      { type: "search" }
    >;

    expect(message).toMatchObject({ type: "search", input: INPUT });
    worker.emit("message", { id: message.id, ok: true, result: RESULT });

    await expect(pending).resolves.toEqual(RESULT);
    search.dispose();
  });

  it("取消只拒绝对应请求并通知 worker", async () => {
    const search = new DesktopAgentRelatedItemSearch(new URL("file:///search-worker.js"));
    const controller = new AbortController();
    const pending = search.search(INPUT, controller.signal);
    const worker = worker_mocks.FakeWorker.instances[0]!;
    const request = worker.messages[0] as Extract<
      RelatedItemSearchWorkerIncomingMessage,
      { type: "search" }
    >;
    const reason = new Error("stop");

    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
    expect(worker.messages[1]).toEqual({ id: request.id, type: "cancel" });
    search.dispose();
  });

  it("worker 失败会拒绝待处理请求并在下一次搜索时重建", async () => {
    const search = new DesktopAgentRelatedItemSearch(new URL("file:///search-worker.js"));
    const first = search.search(INPUT, new AbortController().signal);
    const worker = worker_mocks.FakeWorker.instances[0]!;
    const failure = new Error("worker failed");

    worker.emit("error", failure);

    await expect(first).rejects.toBe(failure);
    const second = search.search(INPUT, new AbortController().signal);
    expect(worker_mocks.FakeWorker.instances).toHaveLength(2);
    search.dispose();
    await expect(second).rejects.toThrow("disposed");
  });

  it("dispose 终止 worker、拒绝待处理请求并阻止后续搜索", async () => {
    const search = new DesktopAgentRelatedItemSearch(new URL("file:///search-worker.js"));
    const pending = search.search(INPUT, new AbortController().signal);
    const worker = worker_mocks.FakeWorker.instances[0]!;

    search.dispose();

    await expect(pending).rejects.toThrow("disposed");
    expect(worker.terminated).toBe(true);
    await expect(search.search(INPUT, new AbortController().signal)).rejects.toThrow("disposed");
  });
});
