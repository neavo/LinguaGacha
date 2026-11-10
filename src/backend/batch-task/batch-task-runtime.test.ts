import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BatchTaskRuntime,
  BATCH_TASK_REQUEST_STATE_PUBLISH_INTERVAL_MS,
  type BatchTaskRunHandle,
} from "./batch-task-runtime";
import { empty_batch_task_progress } from "../../domain/batch-task";
import { RuntimeOperationGate } from "../runtime-operation-gate";
import { ProjectSessionState } from "../project/project-session-state";

/** 共享生命周期只依赖真实会话与门禁。 */
function setup() {
  const gate = new RuntimeOperationGate();
  const session = new ProjectSessionState();
  return { runtime: new BatchTaskRuntime(session, gate), gate, session };
}
/** 挂起真实收尾边界，由用例决定完成次序。 */
function deferred<T>() {
  return Promise.withResolvers<T>();
}
const result = () => "done" as const;
afterEach(() => vi.useRealTimers());

describe("共享批次完成链", () => {
  it.each(["standalone", "agent"] as const)(
    "%s 来源保留至终态，新任务和工程关闭重置展示",
    async (source) => {
      const { runtime, gate, session } = setup();
      const lease = source === "agent" ? gate.begin_runtime("agent") : null;
      const frames: Array<{ status: string; source: string | null }> = [];
      runtime.subscribe((snapshot) => {
        frames.push({ status: snapshot.status, source: snapshot.source });
      });
      const handle =
        lease === null
          ? runtime.begin_standalone()
          : runtime.begin_under_agent(lease, new AbortController().signal, "request");
      await runtime.execute(handle, async () => {
        await runtime.publish_status(handle, "running");
        return "error";
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
    },
  );
  it("本轮配置隔离引用并保留终态，新运行从空配置开始", async () => {
    const { runtime } = setup();
    const handle = runtime.begin_standalone();
    const config = {
      model_config_id: "fixture",
      concurrency_limit: 2,
      rpm_limit: 0,
      model_name: "翻译模型",
      model_id: "test-model",
      thinking_level: "HIGH" as const,
    };
    await runtime.execute(handle, async () => {
      await runtime.publish_config(handle, config);
      config.model_name = "后来改名";
      return "done";
    });
    await handle.completion;
    const snapshot = await runtime.build_snapshot();
    expect(snapshot.config?.model_name).toBe("翻译模型");
    expect(snapshot.config?.thinking_level).toBe("HIGH");
    const next = runtime.begin_standalone();
    await runtime.publish_config(handle, config);
    expect((await runtime.build_snapshot()).config).toBeNull();
    await runtime.execute(next, async () => "done");
    await next.completion;
    await runtime.dispose();
  });

  it("恢复快照隔离输入，取消和新运行拒绝旧恢复状态", async () => {
    vi.useFakeTimers();
    const { runtime } = setup();
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
      await runtime.request_stop(runtime.build_snapshot().run_id ?? "");
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
    }
  });
  it("压力按发布窗口合并且终态前冲刷，迟到进度不覆盖新运行", async () => {
    vi.useFakeTimers();
    const { runtime, gate } = setup();
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
    await vi.advanceTimersByTimeAsync(BATCH_TASK_REQUEST_STATE_PUBLISH_INTERVAL_MS - 1);
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
    await runtime.publish_progress(next, empty_batch_task_progress("item", 1));
    await runtime.publish_progress(handle, empty_batch_task_progress("item", 99));
    expect(runtime.build_snapshot().progress?.total).toBe(1);
    await runtime.dispose();
    await next.completion;
  });
  it("用户停止在收尾前公开来源，重复停止与父取消保留首次来源", async () => {
    const { runtime, gate } = setup();
    const parent = new AbortController();
    const lease = gate.begin_runtime("agent");
    const work = deferred<ReturnType<typeof result>>();
    const handle = runtime.begin_under_agent(lease, parent.signal, "request");
    await runtime.execute(handle, () => work.promise);
    expect(await runtime.request_stop(runtime.build_snapshot().run_id ?? "")).toBe(true);
    expect(await runtime.build_snapshot()).toMatchObject({
      status: "stopping",
      stop_source: "user",
    });
    expect(await runtime.request_stop(runtime.build_snapshot().run_id ?? "")).toBe(false);
    parent.abort();
    work.resolve(result());
    expect(await handle.completion).toMatchObject({ status: "stopped", stop_source: "user" });
    expect(await runtime.build_snapshot()).toMatchObject({
      status: "stopped",
      stop_source: "user",
    });
    expect(await runtime.request_stop(runtime.build_snapshot().run_id ?? "")).toBe(false);
    gate.finish_runtime(lease);
    const next = runtime.begin_standalone();
    expect((await runtime.build_snapshot()).stop_source).toBeNull();
    await runtime.execute(next, async () => result());
    expect((await next.completion).stop_source).toBeUndefined();
    await runtime.dispose();
  });
  it("执行已返回但压力发布仍在收尾时受理的停止进入同一最终结果", async () => {
    const { runtime } = setup();
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
    expect(await runtime.request_stop(runtime.build_snapshot().run_id ?? "")).toBe(true);
    release.resolve();
    expect(await handle.completion).toMatchObject({ status: "stopped", stop_source: "user" });
    await runtime.dispose();
  });
  it("用户停止后的收尾失败保留停止来源并结算失败", async () => {
    const { runtime } = setup();
    const work = deferred<ReturnType<typeof result>>();
    const failure = new Error("cleanup failed");
    const handle = runtime.begin_standalone();
    await runtime.execute(handle, async () => {
      await work.promise;
      throw failure;
    });
    await runtime.request_stop(runtime.build_snapshot().run_id ?? "");
    work.resolve(result());
    await expect(handle.completion).rejects.toMatchObject({
      cause: failure,
      result: { status: "error", stop_source: "user" },
    });
    expect(await runtime.build_snapshot()).toMatchObject({ status: "error", stop_source: "user" });
    await runtime.dispose();
  });
  it("用户在预约发布期间停止，发布失败仍携带停止结果", async () => {
    const { runtime } = setup();
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
    await runtime.request_stop(runtime.build_snapshot().run_id ?? "");
    release.resolve();
    await expect(execution).rejects.toMatchObject({
      cause: failure,
      result: { status: "error", stop_source: "user" },
    });
    expect(runner).not.toHaveBeenCalled();
    await runtime.dispose();
  });
  it("预约发布失败恢复前置状态并结算 rejection，随后可以启动", async () => {
    const { runtime, gate } = setup();
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
  });
  it("standalone 等待执行收尾和终态 listener 后释放 lease，结果与后续运行隔离", async () => {
    const { runtime, gate } = setup();
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
    const progress = { ...empty_batch_task_progress("item", 2), succeeded: 2 };
    await runtime.publish_progress(handle, progress);
    const output = result();
    work.resolve(output);
    await vi.waitFor(async () => expect((await runtime.build_snapshot()).status).toBe("done"));
    expect(settled).not.toHaveBeenCalled();
    expect(gate.get_snapshot().owner).toBe("batch_translation");
    expect(await runtime.request_stop(runtime.build_snapshot().run_id ?? "")).toBe(false);
    terminal.resolve();
    expect(await handle.completion).toMatchObject({ status: "done", progress: { succeeded: 2 } });
    expect(gate.get_snapshot().owner).toBeNull();
    progress.succeeded = 20;
    expect((await handle.completion).progress?.succeeded).toBe(2);
    unsubscribe();
    await runtime.dispose();
  });
  it("Agent 只接受当前 lease 并单向传播父取消，完成后保留 Agent owner", async () => {
    const { runtime, gate } = setup();
    const lease = gate.begin_runtime("agent");
    const parent = new AbortController();
    expect(() => runtime.begin_under_agent({ owner: "agent" }, parent.signal, "request")).toThrow();
    const handle = runtime.begin_under_agent(lease, parent.signal, "request");
    const work = deferred<ReturnType<typeof result>>();
    await runtime.execute(handle, () => work.promise);
    parent.abort();
    expect(await runtime.request_stop(runtime.build_snapshot().run_id ?? "")).toBe(false);
    expect(handle.signal.aborted).toBe(true);
    expect(() => runtime.begin_standalone()).toThrow();
    work.resolve(result());
    expect(await handle.completion).toMatchObject({ status: "stopped", stop_source: "parent" });
    expect(gate.get_snapshot().owner).toBe("agent");
    gate.finish_runtime(lease);
    await runtime.dispose();
  });
  it("终态订阅失败仍结算并释放 lease", async () => {
    const { runtime, gate } = setup();
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
  });
  it("执行异常发布 error，rejection 携带终态统计与原始异常", async () => {
    const { runtime, gate } = setup();
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
  });
  it("预约后立即 dispose 也等待同一个 completion", async () => {
    const { runtime, gate } = setup();
    const handle = runtime.begin_standalone();
    await runtime.dispose();
    expect(handle.signal.aborted).toBe(true);
    expect(await handle.completion).toMatchObject({ status: "stopped", stop_source: "shutdown" });
    expect(gate.get_snapshot().owner).toBeNull();
  });
  it("终态发布期间的父取消不改写已结算结果", async () => {
    const { runtime, gate } = setup();
    const lease = gate.begin_runtime("agent");
    const parent = new AbortController();
    runtime.subscribe((snapshot) => {
      if (snapshot.status === "done") parent.abort();
    });
    const handle = runtime.begin_under_agent(lease, parent.signal, "request");
    await runtime.execute(handle, async () => "done");
    const completed = await handle.completion;
    expect(completed.status).toBe("done");
    expect(completed.stop_source).toBeUndefined();
    gate.finish_runtime(lease);
    await runtime.dispose();
  });

  it("结果索引发布失败仍发布错误终态", async () => {
    const { runtime, gate } = setup();
    const frames: string[] = [];
    runtime.subscribe((snapshot) => {
      frames.push(snapshot.status);
    });
    const handle = runtime.begin_standalone();
    await runtime.execute(
      handle,
      async () => "done",
      async () => {
        throw new Error("index write failed");
      },
    );
    await expect(handle.completion).rejects.toMatchObject({ result: { status: "error" } });
    expect(frames.at(-1)).toBe("error");
    expect(gate.get_snapshot().owner).toBeNull();
    await runtime.dispose();
  });

  it("释放租约时启动下一批次，旧回执仍保留本轮进度", async () => {
    const { runtime, gate } = setup();
    const first = runtime.begin_standalone();
    await runtime.publish_progress(first, {
      ...empty_batch_task_progress("item", 2),
      succeeded: 2,
    });
    let next: BatchTaskRunHandle | undefined;
    const unsubscribe = gate.subscribe((snapshot) => {
      if (snapshot.owner === null && next === undefined) next = runtime.begin_standalone();
    });
    await runtime.execute(first, async () => "done");
    const completed = await first.completion;
    unsubscribe();
    try {
      expect(completed.progress?.succeeded).toBe(2);
      expect(runtime.build_snapshot().run_id).toBe(next?.run_id);
    } finally {
      await runtime.dispose();
    }
  });
});
