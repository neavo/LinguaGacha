import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  BackendRuntimeMainMessage,
  BackendRuntimeReady,
  BackendRuntimeWorkerMessage,
} from "../../shared/backend-runtime";
import { BackendRuntimeClient } from "./backend-runtime-client";
import type { PDFHost } from "../../shared/pdf";
import type { AgentImageHost } from "../../shared/agent-image";

const worker_threads_mock = await vi.hoisted(async () => {
  const { EventEmitter } = await import("node:events");

  /** 用原生事件语义替代线程，只记录跨线程消息与终止结果。 */
  class FakeWorker extends EventEmitter {
    static instances: FakeWorker[] = [];

    readonly posted_messages: BackendRuntimeMainMessage[] = [];
    readonly worker_data: unknown;
    terminate_count = 0;

    /** 捕获启动快照，供测试驱动当前 worker 的生命周期。 */
    constructor(_entry_url: URL, options: { workerData: unknown }) {
      super();
      this.worker_data = options.workerData;
      FakeWorker.instances.push(this);
    }

    /** 记录 main 发出的结构化消息，供协议断言消费。 */
    postMessage(message: BackendRuntimeMainMessage): void {
      this.posted_messages.push(message);
    }

    /** 显式终止同步发出 exit，覆盖关闭时的回调顺序。 */
    async terminate(): Promise<number> {
      this.terminate_count += 1;
      this.emit("exit", 0);
      return 0;
    }
  }

  return { FakeWorker };
});

vi.mock("node:worker_threads", () => ({
  Worker: worker_threads_mock.FakeWorker,
}));

const READY: BackendRuntimeReady = {
  apiBaseUrl: "http://127.0.0.1:4567",
  berserkerUpdateRootDir: "E:/userdata/berserker",
  appVersion: "1.2.3",
};
describe("BackendRuntimeClient", () => {
  it("图片处理沿宿主通道返回字节，取消传到当前窗口操作", async () => {
    const image = {
      bytes: new Uint8Array([1, 2]),
      width: 2,
      height: 1,
      originalWidth: 2,
      originalHeight: 1,
    };
    let cancelled = false;
    const host = vi
      .fn<AgentImageHost>()
      .mockResolvedValueOnce(image)
      .mockImplementation(
        async (_operation, signal) =>
          await new Promise((_resolve, reject) =>
            signal.addEventListener(
              "abort",
              () => {
                cancelled = true;
                reject(signal.reason);
              },
              { once: true },
            ),
          ),
      );
    const { client } = create_client(undefined, host);
    const start = client.start();
    const worker = get_worker();
    worker.emit("message", { type: "ready", data: READY } satisfies BackendRuntimeWorkerMessage);
    await start;
    const request = (requestId: string) =>
      worker.emit("message", {
        type: "host_request",
        requestId,
        operation: {
          kind: "prepare_image",
          bytes: new Uint8Array([1]),
          mimeType: "image/png",
          policy: { maxEdge: 1920, maxPixels: 32_000_000, maxBytes: 1024, quality: 0.85 },
        },
      } satisfies BackendRuntimeWorkerMessage);
    request("image");
    await vi.waitFor(() =>
      expect(worker.posted_messages).toContainEqual({
        type: "host_response",
        requestId: "image",
        result: { ok: true, data: image },
      }),
    );
    request("cancel");
    worker.emit("message", {
      type: "host_cancel",
      requestId: "cancel",
    } satisfies BackendRuntimeWorkerMessage);
    await vi.waitFor(() =>
      expect(worker.posted_messages).toContainEqual(
        expect.objectContaining({
          requestId: "cancel",
          result: expect.objectContaining({ ok: false }),
        }),
      ),
    );
    expect(cancelled).toBe(true);
  });
  beforeEach(() => {
    worker_threads_mock.FakeWorker.instances.length = 0;
  });

  it("启动后按 requestId 结算控制请求并完成正常停止", async () => {
    const { client, on_unexpected_exit } = create_client();
    const start = client.start();
    const worker = get_worker();

    worker.emit("message", { type: "ready", data: READY } satisfies BackendRuntimeWorkerMessage);
    await expect(start).resolves.toEqual(READY);
    expect(worker.worker_data).toEqual({
      appRoot: "E:/app",
      builtinRoot: "E:/app.asar/builtin",
      workspaceRuntimeDirectory: "E:/runtime",
    });

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

  it("PDF 字节回包保留类型，取消和 worker 退出传递到宿主", async () => {
    const signals: AbortSignal[] = [];
    const host = vi
      .fn<PDFHost>()
      .mockResolvedValueOnce(new Uint8Array([1, 2, 3]))
      .mockImplementation(async (_operation, signal) => {
        if (!signal) throw new Error("Missing signal");
        signals.push(signal);
        return await new Promise<Uint8Array>((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
        );
      });
    const { client } = create_client(host);
    const start = client.start();
    const worker = get_worker();
    worker.emit("message", { type: "ready", data: READY } satisfies BackendRuntimeWorkerMessage);
    await start;
    const request = (id: string) =>
      worker.emit("message", {
        type: "host_request",
        requestId: id,
        operation: { kind: "print_pdf", html: "<p>译文</p>" },
      } satisfies BackendRuntimeWorkerMessage);
    request("bytes");
    await vi.waitFor(() =>
      expect(worker.posted_messages).toContainEqual({
        type: "host_response",
        requestId: "bytes",
        result: { ok: true, data: new Uint8Array([1, 2, 3]) },
      }),
    );
    request("cancel");
    worker.emit("message", {
      type: "host_cancel",
      requestId: "cancel",
    } satisfies BackendRuntimeWorkerMessage);
    await vi.waitFor(() =>
      expect(worker.posted_messages).toContainEqual(
        expect.objectContaining({
          requestId: "cancel",
          result: expect.objectContaining({ ok: false }),
        }),
      ),
    );
    expect(signals[0]?.aborted).toBe(true);
    request("exit");
    worker.emit("exit", 1);
    expect(signals[1]?.aborted).toBe(true);
  });

  it("把宿主回调结果送回 worker，并保留失败诊断", async () => {
    const { client, resolve_proxy, open_directory, pick_save_path } = create_client();
    pick_save_path.mockResolvedValueOnce("E:/结果.md");
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
      operation: { kind: "open_directory", path: "E:/output" },
    } satisfies BackendRuntimeWorkerMessage);
    worker.emit("message", {
      type: "host_request",
      requestId: "save-1",
      operation: { kind: "pick_save_path", defaultName: "结果.md" },
    } satisfies BackendRuntimeWorkerMessage);
    await vi.waitFor(() => expect(worker.posted_messages).toHaveLength(3));
    expect(pick_save_path).toHaveBeenCalledWith("结果.md");
    expect(worker.posted_messages).toContainEqual({
      type: "host_response",
      requestId: "save-1",
      result: { ok: true, data: "E:/结果.md" },
    });

    expect(resolve_proxy).toHaveBeenCalledWith("https://example.com");
    expect(open_directory).toHaveBeenCalledWith("E:/output");
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

/** 默认宿主保留成功与失败两种结果，测试仅替换线程。 */
function create_client(
  pdfHost?: PDFHost,
  imageHost: AgentImageHost = async () => {
    throw new Error("Unexpected image request.");
  },
) {
  const resolve_proxy = vi.fn(async () => "DIRECT");
  const open_directory = vi.fn(async () => {
    throw new Error("无法打开目录");
  });
  const pick_save_path = vi.fn(async (_name: string): Promise<string | null> => null);
  const on_unexpected_exit = vi.fn();
  return {
    client: new BackendRuntimeClient({
      workerEntryUrl: new URL("file:///backend-runtime-worker-entry.js"),
      appRoot: "E:/app",
      builtinRoot: "E:/app.asar/builtin",
      workspaceRuntimeDirectory: "E:/runtime",
      resolveProxy: resolve_proxy,
      openDirectory: open_directory,
      pickSavePath: pick_save_path,
      ...(pdfHost === undefined ? {} : { pdfHost }),
      imageHost,
      onUnexpectedExit: on_unexpected_exit,
    }),
    resolve_proxy,
    open_directory,
    pick_save_path,
    on_unexpected_exit,
  };
}

/** 取得本用例创建的 worker；缺失直接暴露启动失败。 */
function get_worker(): InstanceType<typeof worker_threads_mock.FakeWorker> {
  const worker = worker_threads_mock.FakeWorker.instances.at(-1);
  if (worker === undefined) throw new Error("缺少 Backend runtime worker。");
  return worker;
}

/** 按消息类型取得当前请求，避免依赖随机 requestId。 */
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
