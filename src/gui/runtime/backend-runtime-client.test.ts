import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  BackendRuntimeAgentWorkspaceRunRequest,
  BackendRuntimeAgentWorkspaceRunResponse,
  BackendRuntimeMainMessage,
  BackendRuntimeReady,
  BackendRuntimeWorkerMessage,
} from "../../shared/backend-runtime";
import { BackendRuntimeClient } from "./backend-runtime-client";

const worker_threads_mock = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;

  class FakeWorker {
    static instances: FakeWorker[] = [];

    readonly posted_messages: BackendRuntimeMainMessage[] = [];
    readonly worker_data: unknown;
    terminate_count = 0;
    private readonly listeners = new Map<string, Listener[]>();

    constructor(
      readonly entry_url: URL,
      options: { workerData?: unknown } = {},
    ) {
      this.worker_data = options.workerData;
      FakeWorker.instances.push(this);
    }

    on(event: string, listener: Listener): this {
      const listeners = this.listeners.get(event) ?? [];
      listeners.push(listener);
      this.listeners.set(event, listeners);
      return this;
    }

    off(event: string, listener: Listener): this {
      this.listeners.set(
        event,
        (this.listeners.get(event) ?? []).filter((candidate) => candidate !== listener),
      );
      return this;
    }

    postMessage(message: BackendRuntimeMainMessage): void {
      this.posted_messages.push(message);
    }

    async terminate(): Promise<number> {
      this.terminate_count += 1;
      this.emit("exit", 0);
      return 0;
    }

    emit(event: string, ...args: unknown[]): void {
      for (const listener of this.listeners.get(event) ?? []) listener(...args);
    }
  }

  return { FakeWorker };
});

vi.mock("node:worker_threads", () => ({
  default: { Worker: worker_threads_mock.FakeWorker },
  Worker: worker_threads_mock.FakeWorker,
}));

const READY: BackendRuntimeReady = {
  apiBaseUrl: "http://127.0.0.1:4567",
  berserkerUpdateRootDir: "E:/userdata/berserker",
};
const VALID_WORKSPACE_SCRIPT = "return null;";

describe("BackendRuntimeClient", () => {
  beforeEach(() => {
    worker_threads_mock.FakeWorker.instances.length = 0;
  });

  it("启动后按 requestId 结算控制请求并完成正常停止", async () => {
    const { client, on_unexpected_exit } = create_client();
    const start = client.start();
    const worker = get_worker();

    worker.emit("message", { type: "ready", data: READY } satisfies BackendRuntimeWorkerMessage);
    await expect(start).resolves.toEqual(READY);
    expect(worker.worker_data).toEqual({ appRoot: "E:/app" });

    const language = client.readAppLanguage();
    const language_request = get_last_request(worker, "read_app_language");
    worker.emit("message", {
      type: "response",
      requestId: language_request.requestId,
      result: { ok: true, data: "EN" },
    } satisfies BackendRuntimeWorkerMessage);
    await expect(language).resolves.toBe("EN");

    const stop = client.stop();
    const stop_request = get_last_request(worker, "stop");
    worker.emit("message", {
      type: "response",
      requestId: stop_request.requestId,
      result: { ok: true, data: null },
    } satisfies BackendRuntimeWorkerMessage);
    await expect(stop).resolves.toBeUndefined();
    expect(worker.terminate_count).toBe(1);
    expect(on_unexpected_exit).not.toHaveBeenCalled();
  });

  it("把宿主回调结果送回 worker，并保留失败诊断", async () => {
    const { client, resolve_proxy, open_output_folder, run_agent_workspace } = create_client();
    const start = client.start();
    const worker = get_worker();
    worker.emit("message", { type: "ready", data: READY } satisfies BackendRuntimeWorkerMessage);
    await start;

    worker.emit("message", {
      type: "host_request",
      requestId: "proxy-1",
      operation: { kind: "resolve_proxy", url: "https://example.com" },
    } satisfies BackendRuntimeWorkerMessage);
    worker.emit("message", {
      type: "host_request",
      requestId: "open-1",
      operation: { kind: "open_output_folder", path: "E:/output" },
    } satisfies BackendRuntimeWorkerMessage);
    worker.emit("message", {
      type: "host_request",
      requestId: "workspace-1",
      operation: {
        kind: "run_agent_workspace",
        request: {
          workspacePath: "E:/workspace/run-1",
          script: VALID_WORKSPACE_SCRIPT,
        },
      },
    } satisfies BackendRuntimeWorkerMessage);
    await vi.waitFor(() => expect(worker.posted_messages).toHaveLength(3));

    expect(resolve_proxy).toHaveBeenCalledWith("https://example.com");
    expect(open_output_folder).toHaveBeenCalledWith("E:/output");
    expect(run_agent_workspace).toHaveBeenCalledWith(
      {
        workspacePath: "E:/workspace/run-1",
        script: VALID_WORKSPACE_SCRIPT,
      },
      expect.any(AbortSignal),
    );
    expect(worker.posted_messages).toContainEqual({
      type: "host_response",
      requestId: "proxy-1",
      result: { ok: true, data: "DIRECT" },
    });
    expect(worker.posted_messages).toContainEqual({
      type: "host_response",
      requestId: "open-1",
      result: { ok: false, error: expect.objectContaining({ message: "无法打开目录" }) },
    });
    expect(worker.posted_messages).toContainEqual({
      type: "host_response",
      requestId: "workspace-1",
      result: {
        ok: true,
        data: { status: "success", result: { workspace_path: "E:/workspace/run-1" } },
      },
    });
  });

  it("按 requestId 取消工作区操作，并在 worker 退出时中止其余宿主操作", async () => {
    const signals: AbortSignal[] = [];
    const { client, run_agent_workspace, on_unexpected_exit } = create_client({
      runAgentWorkspace: vi.fn((_, signal: AbortSignal) => {
        signals.push(signal);
        return new Promise<never>((_, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      }),
    });
    const start = client.start();
    const worker = get_worker();
    worker.emit("message", { type: "ready", data: READY } satisfies BackendRuntimeWorkerMessage);
    await start;
    worker.emit("message", {
      type: "host_request",
      requestId: "workspace-1",
      operation: {
        kind: "run_agent_workspace",
        request: {
          workspacePath: "E:/workspace/one",
          script: VALID_WORKSPACE_SCRIPT,
        },
      },
    } satisfies BackendRuntimeWorkerMessage);
    worker.emit("message", {
      type: "host_request",
      requestId: "workspace-2",
      operation: {
        kind: "run_agent_workspace",
        request: {
          workspacePath: "E:/workspace/two",
          script: VALID_WORKSPACE_SCRIPT,
        },
      },
    } satisfies BackendRuntimeWorkerMessage);
    await vi.waitFor(() => expect(run_agent_workspace).toHaveBeenCalledTimes(2));

    worker.emit("message", {
      type: "host_cancel",
      requestId: "workspace-1",
    } satisfies BackendRuntimeWorkerMessage);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    await vi.waitFor(() =>
      expect(worker.posted_messages).toContainEqual({
        type: "host_response",
        requestId: "workspace-1",
        result: { ok: false, error: expect.any(Object) },
      }),
    );

    worker.emit("exit", 1);
    expect(signals[1]?.aborted).toBe(true);
    expect(on_unexpected_exit).toHaveBeenCalledOnce();
  });

  it("ready 后意外退出会拒绝 pending 请求并上报一次", async () => {
    const { client, on_unexpected_exit } = create_client();
    const start = client.start();
    const worker = get_worker();
    worker.emit("message", { type: "ready", data: READY } satisfies BackendRuntimeWorkerMessage);
    await start;
    const language = client.readAppLanguage();

    worker.emit("exit", 0);

    await expect(language).rejects.toThrow("Backend runtime worker exited: 0.");
    expect(on_unexpected_exit).toHaveBeenCalledTimes(1);
    expect(client.isStopped()).toBe(true);
  });

  it("error 先于 exit 到达时立即关闭请求入口且只上报一次", async () => {
    const { client, on_unexpected_exit } = create_client();
    const start = client.start();
    const worker = get_worker();
    worker.emit("message", { type: "ready", data: READY } satisfies BackendRuntimeWorkerMessage);
    await start;
    const language = client.readAppLanguage();

    worker.emit("error", new Error("worker error"));

    await expect(language).rejects.toThrow("worker error");
    await expect(client.readAppLanguage()).rejects.toThrow(
      "Backend runtime worker has not started.",
    );
    worker.emit("exit", 1);
    expect(on_unexpected_exit).toHaveBeenCalledTimes(1);
    expect(client.isStopped()).toBe(true);
  });

  it("启动失败只拒绝 start，不误报 ready 后异常退出", async () => {
    const { client, on_unexpected_exit } = create_client();
    const start = client.start();
    const worker = get_worker();

    worker.emit("message", {
      type: "start_failed",
      error: { message: "启动失败" },
    } satisfies BackendRuntimeWorkerMessage);
    worker.emit("exit", 0);

    await expect(start).rejects.toThrow("启动失败");
    expect(on_unexpected_exit).not.toHaveBeenCalled();
    expect(client.isStopped()).toBe(true);
  });

  it("主动停止期间 worker 提前退出也会拒绝 stop，不触发意外退出回调", async () => {
    const { client, on_unexpected_exit } = create_client();
    const start = client.start();
    const worker = get_worker();
    worker.emit("message", { type: "ready", data: READY } satisfies BackendRuntimeWorkerMessage);
    await start;
    const stop = client.stop();

    worker.emit("exit", 0);

    await expect(stop).rejects.toThrow("Backend runtime worker exited: 0.");
    expect(on_unexpected_exit).not.toHaveBeenCalled();
  });
});

function create_client(overrides?: {
  runAgentWorkspace?: (
    request: BackendRuntimeAgentWorkspaceRunRequest,
    signal: AbortSignal,
  ) => Promise<BackendRuntimeAgentWorkspaceRunResponse>;
}) {
  const resolve_proxy = vi.fn(async () => "DIRECT");
  const open_output_folder = vi.fn(async () => {
    throw new Error("无法打开目录");
  });
  const on_unexpected_exit = vi.fn();
  const run_agent_workspace =
    overrides?.runAgentWorkspace ??
    vi.fn(async (request: { workspacePath: string }) => ({
      status: "success" as const,
      result: { workspace_path: request.workspacePath },
    }));
  return {
    client: new BackendRuntimeClient({
      workerEntryUrl: new URL("file:///backend-runtime-worker-entry.js"),
      appRoot: "E:/app",
      resolveProxy: resolve_proxy,
      openOutputFolder: open_output_folder,
      runAgentWorkspace: run_agent_workspace,
      onUnexpectedExit: on_unexpected_exit,
    }),
    resolve_proxy,
    open_output_folder,
    run_agent_workspace,
    on_unexpected_exit,
  };
}

function get_worker(): InstanceType<typeof worker_threads_mock.FakeWorker> {
  const worker = worker_threads_mock.FakeWorker.instances.at(-1);
  if (worker === undefined) throw new Error("缺少 Backend runtime worker。");
  return worker;
}

function get_last_request<TType extends BackendRuntimeMainMessage["type"]>(
  worker: InstanceType<typeof worker_threads_mock.FakeWorker>,
  type: TType,
): Extract<BackendRuntimeMainMessage, { type: TType }> {
  const message = worker.posted_messages.findLast(
    (candidate): candidate is Extract<BackendRuntimeMainMessage, { type: TType }> =>
      candidate.type === type,
  );
  if (message === undefined) throw new Error(`缺少 ${type} 请求。`);
  return message;
}
