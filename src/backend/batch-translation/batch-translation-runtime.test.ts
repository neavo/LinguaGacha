import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BatchTranslationRuntime,
  BATCH_TRANSLATION_REQUEST_STATE_PUBLISH_INTERVAL_MS,
} from "./batch-translation-runtime";
import { RuntimeOperationGate } from "../runtime-operation-gate";
import { ProjectSessionState } from "../project/project-session-state";
import { ProjectDatabase } from "../database/database-operations";
import { normalize_batch_translation_progress } from "../../domain/batch-translation";

/** 用内存数据库与真实运行门禁验证完成链。 */
function setup() {
  const database = new ProjectDatabase("1.0.0");
  const gate = new RuntimeOperationGate();
  const session = new ProjectSessionState();
  const runtime = new BatchTranslationRuntime(session, database, gate);
  return { runtime, gate, database, session };
}
/** 显式控制执行和发布的收尾时机。 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}
/** 提供已完成两条的最小运行结果。 */
const result = () => ({
  status: "done" as const,
  progress: normalize_batch_translation_progress({ processed_line: 2, total_line: 2 }),
});

describe("批量翻译完成链", () => {
  it.each(["standalone", "agent"] as const)(
    "%s 来源保留至终态，新任务和工程关闭重置展示",
    async (source) => {
      const { runtime, gate, database, session } = setup();
      const lease = source === "agent" ? gate.begin_runtime("agent") : null;
      const frames: Array<{ status: string; source: string | null }> = [];
      runtime.subscribe((snapshot) => {
        frames.push({ status: snapshot.status, source: snapshot.source });
      });
      const handle =
        lease === null
          ? runtime.begin_standalone()
          : runtime.begin_under_agent(lease, new AbortController().signal);
      await runtime.execute(handle, async () => {
        await runtime.publish_status(handle, "running");
        return { ...result(), status: "error" };
      });
      await handle.completion;
      expect(frames).toEqual([
        { status: "requested", source },
        { status: "running", source },
        { status: "error", source },
      ]);
      expect(await runtime.build_snapshot()).toMatchObject({ source, request_recovery: null });
      if (lease !== null) gate.finish_runtime(lease);
      const next = runtime.begin_standalone();
      expect(await runtime.build_snapshot()).toMatchObject({
        source: "standalone",
        request_recovery: null,
      });
      await runtime.execute(next, async () => result());
      await next.completion;
      await session.clear();
      expect(await runtime.build_snapshot()).toMatchObject({
        status: "idle",
        source: null,
        request_recovery: null,
      });
      await runtime.dispose();
      await database.close();
    },
  );
  it("异步读取期间目标与本轮进度保持同一版本", async () => {
    const { runtime, database } = setup();
    const handle = runtime.begin_standalone();
    await runtime.execute(handle, async () => {
      const pending = deferred<ReturnType<typeof normalize_batch_translation_progress>>();
      vi.spyOn(runtime, "read_progress").mockReturnValueOnce(pending.promise);
      const before = runtime.build_snapshot();
      await runtime.publish_targets(handle, new Set([2]));
      pending.resolve(normalize_batch_translation_progress({}));
      expect(await before).toMatchObject({ pending_item_ids: [], run_progress: undefined });
      expect(await runtime.build_snapshot()).toMatchObject({
        pending_item_ids: [2],
        run_progress: { total_line: 1 },
      });
      return result();
    });
    await handle.completion;
    await runtime.dispose();
    await database.close();
  });
  it("本轮配置隔离引用并保留终态，新运行从空配置开始", async () => {
    const { runtime, database } = setup();
    const handle = runtime.begin_standalone();
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
    const next = runtime.begin_standalone();
    await runtime.publish_config(handle, config);
    expect((await runtime.build_snapshot()).config).toBeUndefined();
    await runtime.execute(next, async () => result());
    await next.completion;
    await runtime.dispose();
    await database.close();
  });
  afterEach(() => vi.useRealTimers());
  it("恢复快照隔离输入，取消和新运行拒绝旧恢复状态", async () => {
    vi.useFakeTimers();
    const { runtime, database } = setup();
    const work = deferred<ReturnType<typeof result>>();
    const handle = runtime.begin_standalone();
    try {
      await runtime.execute(handle, () => work.promise);
      await runtime.publish_status(handle, "running");
      const recovery = { phase: "waiting" as const, retry_count: 3, retry_at: Date.now() + 60_000 };
      runtime.update_request_state(handle, {
        request_in_flight_count: 0,
        request_recovery: recovery,
      });
      recovery.retry_count = 99;
      expect((await runtime.build_snapshot()).request_recovery).toMatchObject({ retry_count: 3 });
      await runtime.request_stop();
      runtime.update_request_state(handle, {
        request_in_flight_count: 1,
        request_recovery: recovery,
      });
      expect((await runtime.build_snapshot()).request_recovery).toBeNull();
      work.resolve(result());
      await handle.completion;
      const next = runtime.begin_standalone();
      runtime.update_request_state(handle, {
        request_in_flight_count: 1,
        request_recovery: recovery,
      });
      expect(await runtime.build_snapshot()).toMatchObject({
        request_in_flight_count: 0,
        request_recovery: null,
      });
      await runtime.execute(next, async () => result());
      await next.completion;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      work.resolve(result());
      await runtime.dispose();
      await database.close();
    }
  });
  it("压力按发布窗口合并且终态前冲刷，迟到进度不覆盖新运行", async () => {
    vi.useFakeTimers();
    const { runtime, gate, database } = setup();
    const frames: Array<{ status: string; count: number }> = [];
    runtime.subscribe((snapshot) => {
      frames.push({ status: snapshot.status, count: snapshot.request_in_flight_count });
    });
    const work = deferred<ReturnType<typeof result>>();
    const handle = runtime.begin_standalone();
    await runtime.execute(handle, () => work.promise);
    frames.length = 0;
    runtime.update_request_state(handle, { request_in_flight_count: 1, request_recovery: null });
    runtime.update_request_state(handle, { request_in_flight_count: 2, request_recovery: null });
    await vi.advanceTimersByTimeAsync(BATCH_TRANSLATION_REQUEST_STATE_PUBLISH_INTERVAL_MS - 1);
    expect(frames).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(frames).toEqual([{ status: "requested", count: 2 }]);
    runtime.update_request_state(handle, { request_in_flight_count: 3, request_recovery: null });
    work.resolve(result());
    await handle.completion;
    expect(frames.slice(-2)).toEqual([
      { status: "requested", count: 3 },
      { status: "done", count: 0 },
    ]);
    expect(gate.get_snapshot().owner).toBeNull();
    const next = runtime.begin_standalone();
    const next_progress = await runtime.publish_targets(next, new Set([4]));
    await runtime.publish_targets(handle, new Set([99]));
    await runtime.publish_progress(handle, [4], { ...next_progress, failed_line: 9 });
    expect((await runtime.build_snapshot()).pending_item_ids).toEqual([4]);
    expect((await runtime.build_snapshot()).run_progress?.failed_line).toBe(0);
    await runtime.dispose();
    await next.completion;
    await database.close();
  });
  it("用户停止在收尾前公开来源，重复停止与父取消保留首次来源", async () => {
    const { runtime, gate, database } = setup();
    const parent = new AbortController();
    const lease = gate.begin_runtime("agent");
    const work = deferred<ReturnType<typeof result>>();
    const handle = runtime.begin_under_agent(lease, parent.signal);
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
    const next = runtime.begin_standalone();
    expect((await runtime.build_snapshot()).stop_source).toBeUndefined();
    await runtime.execute(next, async () => result());
    expect((await next.completion).stop_source).toBeUndefined();
    await runtime.dispose();
    await database.close();
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
    const handle = runtime.begin_standalone();
    await runtime.execute(handle, () => work.promise);
    runtime.update_request_state(handle, { request_in_flight_count: 1, request_recovery: null });
    work.resolve(result());
    await publishing.promise;
    expect(await runtime.request_stop()).toBe(true);
    release.resolve();
    expect(await handle.completion).toMatchObject({ status: "stopped", stop_source: "user" });
    await runtime.dispose();
    await database.close();
  });
  it("用户停止后的收尾失败保留停止来源并结算失败", async () => {
    const { runtime, database } = setup();
    const work = deferred<ReturnType<typeof result>>();
    const failure = new Error("cleanup failed");
    const handle = runtime.begin_standalone();
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
    await database.close();
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
    const handle = runtime.begin_standalone();
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
    await database.close();
  });
  it("预约发布失败恢复前置状态并结算 rejection，随后可以启动", async () => {
    const { runtime, gate, database } = setup();
    const error = new Error("reservation failed");
    const unsubscribe = runtime.subscribe((snapshot) => {
      if (snapshot.status === "requested") throw error;
    });
    const handle = runtime.begin_standalone();
    const run = vi.fn(async () => result());
    await expect(runtime.execute(handle, run)).rejects.toBe(error);
    await expect(handle.completion).rejects.toBe(error);
    expect(run).not.toHaveBeenCalled();
    expect(gate.get_snapshot().owner).toBeNull();
    expect(await runtime.build_snapshot()).toMatchObject({ status: "idle", source: null });
    unsubscribe();
    const next = runtime.begin_standalone();
    await runtime.execute(next, async () => result());
    await next.completion;
    await runtime.dispose();
    await database.close();
  });
  it.each(["done", "stopped", "error"] as const)(
    "实际目标和总量一起发布，提交移除 ID，%s 终态清空 ID",
    async (status) => {
      const { runtime, database } = setup();
      const item_ids = new Set([1, 2, 3]);
      const frames: import("../../domain/batch-translation").BatchTranslationSnapshot[] = [];
      runtime.subscribe((snapshot) => {
        frames.push(snapshot);
      });
      const handle = runtime.begin_standalone("retranslate");
      expect(await runtime.build_snapshot()).toMatchObject({
        pending_item_ids: [],
        run_progress: undefined,
      });
      await runtime.publish_targets(handle, item_ids);
      item_ids.add(4);
      expect(frames.at(-1)).toMatchObject({
        pending_item_ids: [1, 2, 3],
        run_progress: { total_line: 3, processed_line: 0 },
      });
      await runtime.publish_progress(handle, [2]);
      expect((await runtime.build_snapshot()).pending_item_ids).toEqual([1, 3]);
      if (status === "stopped") {
        await runtime.request_stop();
        expect(handle.signal.aborted).toBe(true);
        expect((await runtime.build_snapshot()).status).toBe("stopping");
      }
      await runtime.execute(handle, async () => ({ ...result(), status }));
      await handle.completion;
      expect(await runtime.build_snapshot()).toMatchObject({
        status,
        source: "standalone",
        pending_item_ids: [],
      });
      await runtime.dispose();
      await database.close();
    },
  );
  it("standalone 等待执行收尾和终态 listener 后释放 lease，结果与后续运行隔离", async () => {
    const { runtime, gate, database } = setup();
    const work = deferred<ReturnType<typeof result>>();
    const terminal = deferred<void>();
    const unsubscribe = runtime.subscribe((snapshot) =>
      snapshot.status === "done" ? terminal.promise : undefined,
    );
    const handle = runtime.begin_standalone();
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
    output.progress.processed_line = 20;
    expect((await handle.completion).progress.processed_line).toBe(2);
    unsubscribe();
    await runtime.dispose();
    await database.close();
  });
  it("Agent 只接受当前 lease 并单向传播父取消，完成后保留 Agent owner", async () => {
    const { runtime, gate, database } = setup();
    const lease = gate.begin_runtime("agent");
    const parent = new AbortController();
    expect(() => runtime.begin_under_agent({ owner: "agent" }, parent.signal)).toThrow();
    const handle = runtime.begin_under_agent(lease, parent.signal);
    const work = deferred<ReturnType<typeof result>>();
    await runtime.execute(handle, () => work.promise);
    parent.abort();
    expect(await runtime.request_stop()).toBe(false);
    expect(handle.signal.aborted).toBe(true);
    expect(() => runtime.begin_standalone()).toThrow();
    work.resolve(result());
    expect(await handle.completion).toMatchObject({ status: "stopped", stop_source: "parent" });
    expect(gate.get_snapshot().owner).toBe("agent");
    gate.finish_runtime(lease);
    await runtime.dispose();
    await database.close();
  });
  it("终态订阅失败仍结算并释放 lease", async () => {
    const { runtime, gate, database } = setup();
    const error = new Error("listener failed");
    runtime.subscribe((snapshot) => {
      if (snapshot.status === "done") throw error;
    });
    const handle = runtime.begin_standalone();
    await runtime.execute(handle, async () => result());
    await expect(handle.completion).rejects.toMatchObject({
      cause: error,
      result: { status: "error" },
    });
    expect(gate.get_snapshot().owner).toBeNull();
    await runtime.dispose();
    await database.close();
  });
  it("执行异常发布 error，rejection 携带终态统计与原始异常", async () => {
    const { runtime, gate, database } = setup();
    const error = new Error("worker infrastructure failed");
    const handle = runtime.begin_standalone();
    await runtime.execute(handle, async () => {
      throw error;
    });
    await expect(handle.completion).rejects.toMatchObject({
      cause: error,
      result: { status: "error" },
    });
    expect((await runtime.build_snapshot()).status).toBe("error");
    expect(gate.get_snapshot().owner).toBeNull();
    await runtime.dispose();
    await database.close();
  });
  it("异常收尾读取失败仍发布错误终态并清空目标", async () => {
    const { runtime, database } = setup();
    const pending_frames: Array<readonly number[]> = [];
    runtime.subscribe((snapshot) => {
      pending_frames.push(snapshot.pending_item_ids);
    });
    const handle = runtime.begin_standalone("retranslate");
    await runtime.execute(handle, async () => {
      await runtime.publish_targets(handle, new Set([1]));
      vi.spyOn(runtime, "read_progress").mockRejectedValueOnce(new Error("progress read failed"));
      throw new Error("execution failed");
    });
    await expect(handle.completion).rejects.toThrow();
    expect(pending_frames).toContainEqual([1]);
    expect(pending_frames.at(-1)).toEqual([]);
    expect(await runtime.build_snapshot()).toMatchObject({
      status: "error",
      pending_item_ids: [],
      request_in_flight_count: 0,
      request_recovery: null,
    });
    await runtime.dispose();
    await database.close();
  });
  it("预约后立即 dispose 也等待同一个 completion", async () => {
    const { runtime, gate, database } = setup();
    const handle = runtime.begin_standalone();
    await runtime.dispose();
    expect(handle.signal.aborted).toBe(true);
    expect(await handle.completion).toMatchObject({ status: "stopped", stop_source: "shutdown" });
    expect(gate.get_snapshot().owner).toBeNull();
    await database.close();
  });
});
