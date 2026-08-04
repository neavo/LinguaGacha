import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  BackendRuntimeMainMessage,
  BackendRuntimeReady,
  BackendRuntimeWebFetchRequest,
  BackendRuntimeWebFetchResponse,
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
  systemProxyStartupNotice: { detected: false, proxiedOriginCount: 0, proxyDisplay: null },
};

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
    const { client, resolve_proxy, open_output_folder, web_fetch } = create_client();
    const start = client.start();
    const worker = get_worker();
    worker.emit("message", { type: "ready", data: READY } satisfies BackendRuntimeWorkerMessage);
    await start;

    worker.emit("message", {
      type: "host_request",
      requestId: "fetch-1",
      operation: { kind: "web_fetch", request: { url: "https://example.com" } },
    } satisfies BackendRuntimeWorkerMessage);
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
    await vi.waitFor(() => expect(worker.posted_messages).toHaveLength(3));

    expect(resolve_proxy).toHaveBeenCalledWith("https://example.com");
    expect(open_output_folder).toHaveBeenCalledWith("E:/output");
    expect(web_fetch).toHaveBeenCalledWith({ url: "https://example.com" }, expect.any(AbortSignal));
    expect(worker.posted_messages).toContainEqual({
      type: "host_response",
      requestId: "fetch-1",
      result: {
        ok: true,
        data: {
          requestedUrl: "https://example.com",
          url: "https://example.com",
          status: 200,
          contentType: "text/plain",
          body: new Uint8Array([111, 107]),
        },
      },
    });
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
  });

  it("按 requestId 取消抓取，并在 worker 退出时中止其余宿主操作", async () => {
    const signals: AbortSignal[] = [];
    const { client, web_fetch, on_unexpected_exit } = create_client({
      webFetch: vi.fn((_, signal: AbortSignal) => {
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
      requestId: "fetch-1",
      operation: { kind: "web_fetch", request: { url: "https://one.example" } },
    } satisfies BackendRuntimeWorkerMessage);
    worker.emit("message", {
      type: "host_request",
      requestId: "fetch-2",
      operation: { kind: "web_fetch", request: { url: "https://two.example" } },
    } satisfies BackendRuntimeWorkerMessage);
    await vi.waitFor(() => expect(web_fetch).toHaveBeenCalledTimes(2));

    worker.emit("message", {
      type: "host_cancel",
      requestId: "fetch-1",
    } satisfies BackendRuntimeWorkerMessage);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    await vi.waitFor(() =>
      expect(worker.posted_messages).toContainEqual({
        type: "host_response",
        requestId: "fetch-1",
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

    await expect(language).rejects.toThrow("Backend runtime worker 退出：0");
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
    await expect(client.readAppLanguage()).rejects.toThrow("Backend runtime worker 未启动");
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

    await expect(stop).rejects.toThrow("Backend runtime worker 退出：0");
    expect(on_unexpected_exit).not.toHaveBeenCalled();
  });
});

function create_client(overrides?: {
  webFetch?: (
    request: BackendRuntimeWebFetchRequest,
    signal: AbortSignal,
  ) => Promise<BackendRuntimeWebFetchResponse>;
}) {
  const resolve_proxy = vi.fn(async () => "DIRECT");
  const open_output_folder = vi.fn(async () => {
    throw new Error("无法打开目录");
  });
  const on_unexpected_exit = vi.fn();
  const web_fetch =
    overrides?.webFetch ??
    vi.fn(async (request: BackendRuntimeWebFetchRequest) => ({
      requestedUrl: request.url,
      url: request.url,
      status: 200,
      contentType: "text/plain",
      body: new Uint8Array([111, 107]),
    }));
  return {
    client: new BackendRuntimeClient({
      workerEntryUrl: new URL("file:///backend-runtime-worker-entry.js"),
      appRoot: "E:/app",
      resolveProxy: resolve_proxy,
      openOutputFolder: open_output_folder,
      webFetch: web_fetch,
      onUnexpectedExit: on_unexpected_exit,
    }),
    resolve_proxy,
    open_output_folder,
    web_fetch,
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
