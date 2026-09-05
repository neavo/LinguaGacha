import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BatchTranslationRuntime,
  BATCH_TRANSLATION_REQUEST_PRESSURE_PUBLISH_INTERVAL_MS,
} from "./batch-translation-runtime";
import { RuntimeOperationGate } from "../runtime-operation-gate";
import { ProjectSessionState } from "../project/project-session-state";
import { ProjectDataReader } from "../project/project-data-reader";
import { ProjectDatabase } from "../database/database-operations";
import { normalize_batch_translation_progress } from "../../domain/batch-translation";

function setup() {
  const database = new ProjectDatabase();
  const gate = new RuntimeOperationGate();
  const runtime = new BatchTranslationRuntime(
    new ProjectSessionState(),
    new ProjectDataReader(database),
    gate,
  );
  return { runtime, gate, database };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}
const result = () => ({
  status: "done" as const,
  progress: normalize_batch_translation_progress({ line: 2, total_line: 2 }),
});

describe("批量翻译完成链", () => {
  afterEach(() => vi.useRealTimers());
  it("压力按发布窗口合并且终态前冲刷，迟到进度不覆盖新运行", async () => {
    vi.useFakeTimers();
    const { runtime, gate, database } = setup();
    const frames: Array<{ status: string; count: number }> = [];
    runtime.subscribe((snapshot) => {
      frames.push({ status: snapshot.status, count: snapshot.request_in_flight_count });
    });
    const work = deferred<ReturnType<typeof result>>();
    const handle = runtime.begin_standalone({ kind: "all" });
    await runtime.execute(handle, () => work.promise);
    frames.length = 0;
    runtime.change_request_in_flight_count(handle, 1);
    runtime.change_request_in_flight_count(handle, 1);
    await vi.advanceTimersByTimeAsync(BATCH_TRANSLATION_REQUEST_PRESSURE_PUBLISH_INTERVAL_MS - 1);
    expect(frames).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(frames).toEqual([{ status: "requested", count: 2 }]);
    runtime.change_request_in_flight_count(handle, 1);
    work.resolve(result());
    await handle.completion;
    expect(frames.slice(-2)).toEqual([
      { status: "requested", count: 3 },
      { status: "done", count: 0 },
    ]);
    expect(gate.get_snapshot().owner).toBeNull();
    const next = runtime.begin_standalone({ kind: "items", item_ids: [4] });
    await runtime.publish_progress(handle, [4]);
    expect((await runtime.build_snapshot()).scope).toEqual({ kind: "items", item_ids: [4] });
    await runtime.dispose();
    await next.completion;
    database.close();
  });
  it("预约发布失败恢复前置状态并结算 rejection，随后可以启动", async () => {
    const { runtime, gate, database } = setup();
    const error = new Error("reservation failed");
    const unsubscribe = runtime.subscribe((snapshot) => {
      if (snapshot.status === "requested") throw error;
    });
    const handle = runtime.begin_standalone({ kind: "all" });
    const run = vi.fn(async () => result());
    await expect(runtime.execute(handle, run)).rejects.toBe(error);
    await expect(handle.completion).rejects.toBe(error);
    expect(run).not.toHaveBeenCalled();
    expect(gate.get_snapshot().owner).toBeNull();
    expect((await runtime.build_snapshot()).status).toBe("idle");
    unsubscribe();
    const next = runtime.begin_standalone({ kind: "all" });
    await runtime.execute(next, async () => result());
    await next.completion;
    await runtime.dispose();
    database.close();
  });
  it("定点重翻只移除真实提交 id，scope 数组与调用方隔离", async () => {
    const { runtime, database } = setup();
    const item_ids = [1, 2, 3];
    const handle = runtime.begin_standalone({ kind: "items", item_ids });
    item_ids.push(4);
    await runtime.publish_progress(handle, [2]);
    expect((await runtime.build_snapshot()).scope).toEqual({ kind: "items", item_ids: [1, 3] });
    await runtime.request_stop();
    expect(handle.signal.aborted).toBe(true);
    expect((await runtime.build_snapshot()).status).toBe("stopping");
    await runtime.dispose();
    database.close();
  });
  it("standalone 等待执行收尾和终态 listener 后释放 lease，结果与后续运行隔离", async () => {
    const { runtime, gate, database } = setup();
    const work = deferred<ReturnType<typeof result>>();
    const terminal = deferred<void>();
    const unsubscribe = runtime.subscribe((snapshot) =>
      snapshot.status === "done" ? terminal.promise : undefined,
    );
    const handle = runtime.begin_standalone({ kind: "all" });
    await runtime.execute(handle, () => work.promise);
    const settled = vi.fn();
    void handle.completion.then(settled);
    expect(gate.get_snapshot().owner).toBe("batch_translation");
    const output = result();
    work.resolve(output);
    await vi.waitFor(async () => expect((await runtime.build_snapshot()).status).toBe("done"));
    expect(settled).not.toHaveBeenCalled();
    expect(gate.get_snapshot().owner).toBe("batch_translation");
    expect(await runtime.request_stop()).toBe(false);
    terminal.resolve();
    expect(await handle.completion).toEqual(output);
    expect(gate.get_snapshot().owner).toBeNull();
    output.progress.line = 20;
    expect((await handle.completion).progress.line).toBe(2);
    unsubscribe();
    await runtime.dispose();
    database.close();
  });
  it("Agent 只接受当前 lease 并单向传播父取消，完成后保留 Agent owner", async () => {
    const { runtime, gate, database } = setup();
    const lease = gate.begin_runtime("agent");
    const parent = new AbortController();
    expect(() =>
      runtime.begin_under_agent({ kind: "all" }, { owner: "agent" }, parent.signal),
    ).toThrow();
    const handle = runtime.begin_under_agent({ kind: "all" }, lease, parent.signal);
    const work = deferred<ReturnType<typeof result>>();
    await runtime.execute(handle, () => work.promise);
    parent.abort();
    expect(handle.signal.aborted).toBe(true);
    expect(() => runtime.begin_standalone({ kind: "all" })).toThrow();
    work.resolve(result());
    await handle.completion;
    expect(gate.get_snapshot().owner).toBe("agent");
    gate.finish_runtime(lease);
    await runtime.dispose();
    database.close();
  });
  it("终态订阅失败仍结算并释放 lease", async () => {
    const { runtime, gate, database } = setup();
    const error = new Error("listener failed");
    runtime.subscribe((snapshot) => {
      if (snapshot.status === "done") throw error;
    });
    const handle = runtime.begin_standalone({ kind: "all" });
    await runtime.execute(handle, async () => result());
    await expect(handle.completion).rejects.toBe(error);
    expect(gate.get_snapshot().owner).toBeNull();
    await runtime.dispose();
    database.close();
  });
  it("执行异常发布 error 并保留原始 rejection", async () => {
    const { runtime, gate, database } = setup();
    const error = new Error("worker infrastructure failed");
    const handle = runtime.begin_standalone({ kind: "all" });
    await runtime.execute(handle, async () => {
      throw error;
    });
    await expect(handle.completion).rejects.toBe(error);
    expect((await runtime.build_snapshot()).status).toBe("error");
    expect(gate.get_snapshot().owner).toBeNull();
    await runtime.dispose();
    database.close();
  });
  it("预约后立即 dispose 也等待同一个 completion", async () => {
    const { runtime, gate, database } = setup();
    const handle = runtime.begin_standalone({ kind: "all" });
    await runtime.dispose();
    expect(handle.signal.aborted).toBe(true);
    expect((await handle.completion).status).toBe("idle");
    expect(gate.get_snapshot().owner).toBeNull();
    database.close();
  });
});
