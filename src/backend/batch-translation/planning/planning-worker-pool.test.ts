import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BackendWorkerExecution } from "../../worker/worker-execution";
import type {
  PlanningWorkerIncomingMessage,
  PlanningWorkerOutgoingMessage,
} from "./planning-worker-types";
import { PlanningWorkerPool } from "./planning-worker-pool";

const { FakeWorker } = await vi.hoisted(async () => {
  const { EventEmitter } = await import("node:events");
  /** 只替代线程传输，事件订阅和退出广播使用 Node 原生实现。 */
  class FakeWorker extends EventEmitter {
    static instances: FakeWorker[] = [];
    readonly messages: PlanningWorkerIncomingMessage[] = []; // 保留已派发消息供时序断言。
    /** 登记实际创建的线程，验证按需启动和故障后的重建。 */
    constructor() {
      super();
      FakeWorker.instances.push(this);
    }
    /** 记录出站消息，回包时机由测试驱动。 */
    postMessage(message: PlanningWorkerIncomingMessage): void {
      this.messages.push(message);
    }
    /** 从 worker 一侧发布带类型的回包。 */
    reply(message: PlanningWorkerOutgoingMessage): void {
      this.emit("message", message);
    }
    /** 关闭必须产生 exit，才能验证池等待实际退出的契约。 */
    async terminate(): Promise<number> {
      this.emit("exit", 0);
      return 0;
    }
  }
  return { FakeWorker };
});
vi.mock("node:worker_threads", () => ({ Worker: FakeWorker }));

const execution: BackendWorkerExecution = {
  kind: "worker_threads",
  planningWorkerEntryUrl: new URL("file:///planning-worker-entry.js"),
  workUnitWorkerEntryUrl: new URL("file:///work-unit-worker-entry.js"),
  computeWorkerEntryUrl: new URL("file:///compute-worker-entry.js"),
};

/** 等待本轮微任务排空，不依赖实现中的 Promise 层数。 */
async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("PlanningWorkerPool", () => {
  const pools: PlanningWorkerPool[] = [];
  beforeEach(() => {
    FakeWorker.instances.length = 0;
  });
  afterEach(async () => {
    await Promise.all(pools.splice(0).map((pool) => pool.dispose()));
  });
  /** 每个池统一登记清理，故障断言失败时也会终止线程。 */
  function create_pool(kind: BackendWorkerExecution = execution): PlanningWorkerPool {
    const pool = new PlanningWorkerPool({ execution: kind, workerCount: 2 });
    pools.push(pool);
    return pool;
  }

  it("同进程模式复用真实计数函数，取消及释放后拒绝请求", async () => {
    const pool = create_pool({ kind: "in_process" });
    await expect(
      pool.count_items(["hello", "", "原文"], new AbortController().signal),
    ).resolves.toEqual([1, 0, 2]);
    const controller = new AbortController();
    controller.abort();
    await expect(pool.count_items(["hello"], controller.signal)).rejects.toMatchObject({
      code: "runtime.cancelled",
    });
    await pool.dispose();
    await expect(pool.count_items([], new AbortController().signal)).rejects.toMatchObject({
      code: "runtime.disposed",
    });
  });

  it("按文本量并行分批并复用线程，迟到回包不污染结果", async () => {
    const pool = create_pool();
    expect(FakeWorker.instances).toHaveLength(0);
    const texts = Array.from({ length: 20 }, (_, index) => "文".repeat(1000 + index * 100));
    const dispatch = vi
      .spyOn(FakeWorker.prototype, "postMessage")
      .mockImplementation(function (this: InstanceType<typeof FakeWorker>, message) {
        this.messages.push(message);
        if (message.type === "count_tokens") {
          const reply = () =>
            this.reply({
              id: message.id,
              status: "done",
              counts: message.texts.map((text) => text.length),
            });
          // 奇数批次晚一轮回包，覆盖跨线程完成顺序与输入顺序不同的情况。
          setImmediate(() => {
            if (message.id % 2 === 0) reply();
            else setImmediate(reply);
          });
        }
      });
    const result = pool.count_items(texts, new AbortController().signal);
    await flush();
    expect(FakeWorker.instances).toHaveLength(2);
    await expect(result).resolves.toEqual(texts.map((text) => text.length));
    dispatch.mockRestore();
    const next = pool.count_items(["abc"], new AbortController().signal);
    await flush();
    const worker = FakeWorker.instances[0]!;
    const message = worker.messages.at(-1)!;
    worker.reply({ id: worker.messages[0]!.id, status: "done", counts: [999] });
    worker.reply({ id: message.id, status: "done", counts: [3] });
    await expect(next).resolves.toEqual([3]);
    expect(FakeWorker.instances).toHaveLength(2);
  });

  it("取消等待所有活动批次结束，期间不接受新请求", async () => {
    const pool = create_pool();
    const controller = new AbortController();
    const result = pool.count_items(["a".repeat(10000), "b".repeat(10000)], controller.signal);
    const rejected = expect(result).rejects.toMatchObject({ code: "runtime.cancelled" });
    await flush();
    controller.abort();
    await expect(pool.count_items([], new AbortController().signal)).rejects.toMatchObject({
      code: "runtime.busy",
    });
    const first = FakeWorker.instances[0]!;
    const second = FakeWorker.instances[1]!;
    first.reply({ id: first.messages[0]!.id, status: "cancelled" });
    await flush();
    await expect(pool.count_items([], new AbortController().signal)).rejects.toMatchObject({
      code: "runtime.busy",
    });
    expect(second.messages.at(-1)?.type).toBe("cancel");
    second.reply({ id: second.messages[0]!.id, status: "done", counts: [10000] });
    await rejected;
    await expect(pool.count_items([], new AbortController().signal)).resolves.toEqual([]);
  });

  it("派发失败释放批次引用，下一次请求可继续使用线程", async () => {
    const pool = create_pool();
    const error = new Error("消息派发失败");
    vi.spyOn(FakeWorker.prototype, "postMessage").mockImplementationOnce(() => {
      throw error;
    });
    await expect(pool.count_items(["abc"], new AbortController().signal)).rejects.toBe(error);
    const next = pool.count_items(["def"], new AbortController().signal);
    await flush();
    const worker = FakeWorker.instances[0]!;
    worker.reply({ id: worker.messages[0]!.id, status: "done", counts: [1] });
    await expect(next).resolves.toEqual([1]);
  });

  it("意外正常退出也使请求失败，下次请求才重建故障线程", async () => {
    const pool = create_pool();
    const result = pool.count_items(["abc"], new AbortController().signal);
    const rejected = expect(result).rejects.toThrow("Planning worker exited: 0");
    await flush();
    FakeWorker.instances[0]!.emit("exit", 0);
    await rejected;
    expect(FakeWorker.instances).toHaveLength(1);
    const next = pool.count_items(["def"], new AbortController().signal);
    await flush();
    const replacement = FakeWorker.instances[1]!;
    replacement.reply({ id: replacement.messages[0]!.id, status: "done", counts: [1] });
    await expect(next).resolves.toEqual([1]);
  });

  it("缺失计数使整次请求失败，dispose 等待活动线程结束", async () => {
    const pool = create_pool();
    const result = pool.count_items(["abc"], new AbortController().signal);
    const rejected = expect(result).rejects.toMatchObject({ code: "worker.execution_failed" });
    await flush();
    const worker = FakeWorker.instances[0]!;
    worker.reply({ id: worker.messages[0]!.id, status: "done", counts: [] });
    await rejected;
    const running = pool.count_items(["def"], new AbortController().signal);
    const stopped = expect(running).rejects.toMatchObject({ code: "runtime.disposed" });
    await flush();
    await pool.dispose();
    await stopped;
  });
});
