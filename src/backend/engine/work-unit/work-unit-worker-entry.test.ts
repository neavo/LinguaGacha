import { afterEach, describe, expect, it, vi } from "vitest";

// 复刻入口私有协议，避免测试导出生产私有类型。
type WorkUnitWorkerIncomingMessage =
  | {
      id: string;
      type: "execute";
      unit: Record<string, unknown>;
    }
  | {
      id: string;
      type: "translate_single";
      body: Record<string, unknown>;
    }
  | {
      id: string;
      type: "cancel";
    };

// 保存入口监听器和回包 spy，测试不创建真实 worker。
type WorkerPortHarness = {
  listener: ((message: WorkUnitWorkerIncomingMessage) => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
  emit: (message: WorkUnitWorkerIncomingMessage) => void;
};

// WorkUnitRunner 的最小行为面，聚焦入口分发和取消语义。
type RunnerMock = {
  run: ReturnType<typeof vi.fn>;
  translate_single: ReturnType<typeof vi.fn>;
};

// harness 固定 workerData 和 parentPort，隔离真实 worker_threads 环境。
function install_worker_threads_mock(worker_data: Record<string, unknown>): WorkerPortHarness {
  const harness: WorkerPortHarness = {
    listener: null,
    postMessage: vi.fn(),
    // emit 模拟测试场景中的对应运行时方法，保持断言聚焦协议行为。
    emit(message) {
      harness.listener?.(message);
    },
  };
  const parent_port = {
    on: vi.fn((event_name: string, listener: (message: WorkUnitWorkerIncomingMessage) => void) => {
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
        workerData: worker_data,
      },
      parentPort: parent_port,
      workerData: worker_data,
    };
  });

  return harness;
}

// WorkUnitRunner 是入口唯一业务依赖，mock class 保留 new 调用语义。
function install_runner_mock(runner: RunnerMock): void {
  vi.doMock("./work-unit-runner", () => {
    // 模拟外部运行时对象，只保留当前测试会触发的行为面。
    class WorkUnitRunnerMock {
      public run = runner.run;
      public translate_single = runner.translate_single;
    }

    return {
      WorkUnitRunner: WorkUnitRunnerMock,
    };
  });
}

// 入口文件有顶层启动副作用，必须等 mock 安装完再动态导入。
async function import_worker_entry(): Promise<void> {
  await import("./work-unit-worker-entry");
}

// run_message 异步回包在微任务中完成，测试用显式 flush 固定断言时序。
async function flush_worker_microtasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("work-unit-worker-entry", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("node:worker_threads");
    vi.doUnmock("./work-unit-runner");
    vi.doUnmock("../../network/system-proxy-dispatcher");
  });

  it("加载时安装代理快照，并把 execute 结果按消息 id 回传", async () => {
    const system_proxy_snapshot = { mode: "fixed", url: "http://127.0.0.1:7890" };
    const harness = install_worker_threads_mock({
      appRoot: "E:/Project/LinguaGacha",
      systemProxySnapshot: system_proxy_snapshot,
    });
    const install_proxy_snapshot = vi.fn();
    vi.doMock("../../network/system-proxy-dispatcher", () => {
      return {
        install_system_proxy_dispatcher_from_snapshot: install_proxy_snapshot,
      };
    });
    const runner = {
      run: vi.fn(async () => ({ outcome: "completed" })),
      translate_single: vi.fn(),
    };
    install_runner_mock(runner);

    await import_worker_entry();

    harness.emit({
      id: "work-1",
      type: "execute",
      unit: { kind: "translation" },
    });
    await flush_worker_microtasks();

    expect(install_proxy_snapshot).toHaveBeenCalledWith(system_proxy_snapshot);
    expect(runner.run).toHaveBeenCalledWith({ kind: "translation" }, expect.any(AbortSignal));
    expect(harness.postMessage).toHaveBeenCalledWith({
      id: "work-1",
      ok: true,
      data: { outcome: "completed" },
    });
  });

  it("cancel 只中断同 id 的运行中消息", async () => {
    const harness = install_worker_threads_mock({
      appRoot: "E:/Project/LinguaGacha",
      systemProxySnapshot: null,
    });
    vi.doMock("../../network/system-proxy-dispatcher", () => {
      return {
        install_system_proxy_dispatcher_from_snapshot: vi.fn(),
      };
    });

    const run_state: {
      signal: AbortSignal | null;
      resolve: ((value: unknown) => void) | null;
    } = {
      signal: null,
      resolve: null,
    };
    const runner = {
      run: vi.fn(
        (_unit: Record<string, unknown>, signal: AbortSignal) =>
          new Promise((resolve) => {
            run_state.signal = signal;
            run_state.resolve = resolve;
          }),
      ),
      translate_single: vi.fn(),
    };
    install_runner_mock(runner);

    await import_worker_entry();

    harness.emit({ id: "work-2", type: "execute", unit: { kind: "analysis" } });
    await flush_worker_microtasks();
    harness.emit({ id: "work-2", type: "cancel" });

    expect(run_state.signal?.aborted).toBe(true);

    run_state.resolve?.({ outcome: "cancelled-after-test" });
    await flush_worker_microtasks();

    expect(harness.postMessage).toHaveBeenCalledWith({
      id: "work-2",
      ok: true,
      data: { outcome: "cancelled-after-test" },
    });
  });
});
