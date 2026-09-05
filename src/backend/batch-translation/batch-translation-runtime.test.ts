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

/** 用内存数据库与真实运行门禁验证完成链。 */
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
/** 显式控制执行和发布的收尾时机。 */
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
  it("本轮配置隔离引用并保留终态，新运行从空配置开始", async () => {
    const { runtime, database } = setup();
    const handle = runtime.begin_standalone({ kind: "all" });
    const config = {
      model_name: "翻译模型",
      model_id: "test-model",
      thinking_level: "HIGH" as const,
      source_language: "JA",
      target_language: "ZH",
    };
    await runtime.execute(handle, async () => {
      await runtime.publish_config(handle, config);
      config.model_name = "后来改名";
      return result();
    });
    await handle.completion;
    const snapshot = await runtime.build_snapshot();
    expect(snapshot.config?.model_name).toBe("翻译模型");
    expect(snapshot.config?.thinking_level).toBe("HIGH");
    const next = runtime.begin_standalone({ kind: "all" });
    await runtime.publish_config(handle, config);
    expect((await runtime.build_snapshot()).config).toBeUndefined();
    await runtime.execute(next, async () => result());
    await next.completion;
    await runtime.dispose();
    database.close();
  });
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
  it("用户停止在收尾前公开来源，重复停止与父取消保留首次来源", async () => {
    const { runtime, gate, database } = setup();
    const parent = new AbortController();
    const lease = gate.begin_runtime("agent");
    const work = deferred<ReturnType<typeof result>>();
    const handle = runtime.begin_under_agent({ kind: "all" }, lease, parent.signal);
    await runtime.execute(handle, () => work.promise);
    expect(await runtime.request_stop()).toBe(true);
    expect(await runtime.build_snapshot()).toMatchObject({
      status: "stopping",
      stop_source: "user",
    });
    expect(await runtime.request_stop()).toBe(false);
    parent.abort();
    work.resolve(result());
    expect(await handle.completion).toMatchObject({ status: "stopped", stop_source: "user" });
    expect(await runtime.build_snapshot()).toMatchObject({
      status: "stopped",
      stop_source: "user",
    });
    expect(await runtime.request_stop()).toBe(false);
    gate.finish_runtime(lease);
    const next = runtime.begin_standalone({ kind: "all" });
    expect((await runtime.build_snapshot()).stop_source).toBeUndefined();
    await runtime.execute(next, async () => result());
    expect((await next.completion).stop_source).toBeUndefined();
    await runtime.dispose();
    database.close();
  });
  it("执行已返回但压力发布仍在收尾时受理的停止进入同一最终结果", async () => {
    const { runtime, database } = setup();
    const work = deferred<ReturnType<typeof result>>();
    const publishing = deferred<void>();
    const release = deferred<void>();
    runtime.subscribe((snapshot) => {
      if (snapshot.status === "requested" && snapshot.request_in_flight_count > 0) {
        publishing.resolve();
        return release.promise;
      }
    });
    const handle = runtime.begin_standalone({ kind: "all" });
    await runtime.execute(handle, () => work.promise);
    runtime.change_request_in_flight_count(handle, 1);
    work.resolve(result());
    await publishing.promise;
    expect(await runtime.request_stop()).toBe(true);
    release.resolve();
    expect(await handle.completion).toMatchObject({ status: "stopped", stop_source: "user" });
    await runtime.dispose();
    database.close();
  });
  it("用户停止后的收尾失败保留停止来源并结算失败", async () => {
    const { runtime, database } = setup();
    const work = deferred<ReturnType<typeof result>>();
    const failure = new Error("cleanup failed");
    const handle = runtime.begin_standalone({ kind: "all" });
    await runtime.execute(handle, async () => {
      await work.promise;
      throw failure;
    });
    await runtime.request_stop();
    work.resolve(result());
    await expect(handle.completion).rejects.toMatchObject({
      cause: failure,
      result: { status: "error", stop_source: "user" },
    });
    expect(await runtime.build_snapshot()).toMatchObject({ status: "error", stop_source: "user" });
    await runtime.dispose();
    database.close();
  });
  it("用户在预约发布期间停止，发布失败仍携带停止结果", async () => {
    const { runtime, database } = setup();
    const release = deferred<void>();
    const failure = new Error("reservation failed");
    runtime.subscribe(async (snapshot) => {
      if (snapshot.status === "requested") {
        await release.promise;
        throw failure;
      }
    });
    const handle = runtime.begin_standalone({ kind: "all" });
    const runner = vi.fn(async () => result());
    const execution = runtime.execute(handle, runner);
    await runtime.request_stop();
    release.resolve();
    await expect(execution).rejects.toMatchObject({
      cause: failure,
      result: { status: "error", stop_source: "user" },
    });
    expect(runner).not.toHaveBeenCalled();
    await runtime.dispose();
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
    expect(await runtime.request_stop()).toBe(false);
    expect(handle.signal.aborted).toBe(true);
    expect(() => runtime.begin_standalone({ kind: "all" })).toThrow();
    work.resolve(result());
    expect(await handle.completion).toMatchObject({ status: "stopped", stop_source: "parent" });
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
    expect(await handle.completion).toMatchObject({ status: "stopped", stop_source: "shutdown" });
    expect(gate.get_snapshot().owner).toBeNull();
    database.close();
  });
});
