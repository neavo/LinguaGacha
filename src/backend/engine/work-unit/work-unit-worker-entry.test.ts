import { afterEach, describe, expect, it, vi } from "vitest";

import {
  flush_worker_microtasks,
  install_worker_threads_mock,
} from "../../../test/worker-port-harness";

// 复刻入口私有协议，避免测试导出生产私有类型。
type WorkUnitWorkerIncomingMessage =
  | {
      id: string;
      type: "execute";
      unit: Record<string, unknown>;
    }
  | {
      id: string;
      type: "cancel";
    };

// WorkUnitRunner 的最小行为面，聚焦入口分发和取消语义。
type RunnerMock = {
  run: ReturnType<typeof vi.fn>;
};

// WorkUnitRunner 是入口唯一业务依赖，mock class 保留 new 调用语义。
function install_runner_mock(runner: RunnerMock): void {
  vi.doMock("./work-unit-runner", () => {
    // 模拟外部运行时对象，只保留当前测试会触发的行为面。
    class WorkUnitRunnerMock {
      public run = runner.run;
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

describe("work-unit-worker-entry", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("node:worker_threads");
    vi.doUnmock("./work-unit-runner");
    vi.doUnmock("../../llm/llm-system-proxy-dispatcher");
  });

  it("加载时安装代理快照，并把 execute 结果按消息 id 回传", async () => {
    const system_proxy_snapshot = { mode: "fixed", url: "http://127.0.0.1:7890" };
    const harness = install_worker_threads_mock<WorkUnitWorkerIncomingMessage>({
      appRoot: "E:/Project/LinguaGacha",
      systemProxySnapshot: system_proxy_snapshot,
    });
    const install_proxy_snapshot = vi.fn();
    vi.doMock("../../llm/llm-system-proxy-dispatcher", () => {
      return {
        install_system_proxy_dispatcher_from_snapshot: install_proxy_snapshot,
      };
    });
    const runner = {
      run: vi.fn(async () => ({ outcome: "completed" })),
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
    const harness = install_worker_threads_mock<WorkUnitWorkerIncomingMessage>({
      appRoot: "E:/Project/LinguaGacha",
      systemProxySnapshot: null,
    });
    vi.doMock("../../llm/llm-system-proxy-dispatcher", () => {
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
