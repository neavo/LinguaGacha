import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  BackendRuntimeMainMessage,
  BackendRuntimeWorkerMessage,
} from "../../shared/backend-runtime";
import { run_backend_runtime, type BackendRuntimePort } from "./backend-runtime";

const runtime_mocks = vi.hoisted(() => {
  const start = vi.fn();
  const stop = vi.fn(async () => undefined);
  const constructor_options: unknown[] = [];
  const log_manager = {
    warning: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  };
  class BackendBootstrap {
    constructor(options: unknown) {
      constructor_options.push(options);
    }

    start = start;
    stop = stop;
  }
  return { BackendBootstrap, constructor_options, log_manager, start, stop };
});

vi.mock("./backend-bootstrap", () => ({ BackendBootstrap: runtime_mocks.BackendBootstrap }));
vi.mock("../app/app-path-service", () => ({
  AppPathService: class {
    get_berserker_update_root_dir(): string {
      return "E:/userdata/berserker";
    }
  },
}));
vi.mock("../worker/worker-execution", () => ({
  resolve_desktop_bundle_dir_from_module_url: () => "E:/app/dist-electron",
  build_worker_threads_backend_worker_execution_from_desktop_bundle_dir: () => ({
    kind: "worker_threads",
  }),
}));
vi.mock("../log/log-text", () => ({ t_main_log: (key: string) => `translated:${key}` }));

describe("run_backend_runtime", () => {
  beforeEach(() => {
    runtime_mocks.constructor_options.length = 0;
    runtime_mocks.start.mockReset();
    runtime_mocks.stop.mockClear();
    runtime_mocks.log_manager.warning.mockClear();
    runtime_mocks.log_manager.error.mockClear();
    runtime_mocks.log_manager.fatal.mockClear();
    runtime_mocks.start.mockResolvedValue({
      apiBaseUrl: "http://127.0.0.1:4567",
      readAppLanguage: () => "EN",
      systemProxyStartupNotice: { detected: false, proxiedOriginCount: 0, proxyDisplay: null },
      backendServices: { logManager: runtime_mocks.log_manager },
    });
  });

  it("发布 ready，并通过结构化消息处理宿主能力与控制请求", async () => {
    const port = create_port();
    await run_backend_runtime({
      appRoot: "E:/app",
      moduleUrl: "file:///E:/app/dist-electron/backend-runtime-worker-entry.js",
      port,
    });

    expect(port.messages[0]).toEqual({
      type: "ready",
      data: {
        apiBaseUrl: "http://127.0.0.1:4567",
        berserkerUpdateRootDir: "E:/userdata/berserker",
        systemProxyStartupNotice: { detected: false, proxiedOriginCount: 0, proxyDisplay: null },
      },
    });
    const bootstrap_options = runtime_mocks.constructor_options[0] as {
      systemProxyResolver: { resolveProxy: (url: string) => Promise<string> };
      openOutputFolder: (path: string) => Promise<void>;
    };
    const proxy = bootstrap_options.systemProxyResolver.resolveProxy("https://example.com");
    const proxy_request = get_host_request(port, "resolve_proxy");
    port.emit({
      type: "host_response",
      requestId: proxy_request.requestId,
      result: { ok: true, data: "PROXY 127.0.0.1:7890" },
    });
    await expect(proxy).resolves.toBe("PROXY 127.0.0.1:7890");

    const open = bootstrap_options.openOutputFolder("E:/output");
    const open_request = get_host_request(port, "open_output_folder");
    port.emit({
      type: "host_response",
      requestId: open_request.requestId,
      result: { ok: false, error: { message: "无法打开目录" } },
    });
    await expect(open).rejects.toThrow("无法打开目录");

    port.emit({ type: "read_app_language", requestId: "language-1" });
    port.emit({
      type: "record_host_diagnostic",
      requestId: "diagnostic-1",
      level: "error",
      messageKey: "app.diagnostic.renderer.process_exited",
      context: { window_kind: "main" },
    });
    port.emit({ type: "stop", requestId: "stop-1" });
    await vi.waitFor(() => expect(port.close).toHaveBeenCalledOnce());

    expect(port.messages).toContainEqual({
      type: "response",
      requestId: "language-1",
      result: { ok: true, data: "EN" },
    });
    expect(runtime_mocks.log_manager.error).toHaveBeenCalledWith(
      "translated:app.diagnostic.renderer.process_exited",
      { source: "electron-main", context: { window_kind: "main" } },
    );
    expect(runtime_mocks.stop).toHaveBeenCalledOnce();
  });

  it("启动失败时发送结构化错误、释放资源并关闭端口", async () => {
    runtime_mocks.start.mockRejectedValueOnce(new Error("端口占用"));
    const port = create_port();

    await run_backend_runtime({ appRoot: "E:/app", moduleUrl: import.meta.url, port });

    expect(port.messages).toContainEqual({
      type: "start_failed",
      error: expect.objectContaining({ message: "端口占用" }),
    });
    expect(runtime_mocks.stop).toHaveBeenCalledOnce();
    expect(port.close).toHaveBeenCalledOnce();
  });
});

function create_port() {
  let listener: ((message: BackendRuntimeMainMessage) => void) | null = null;
  const messages: BackendRuntimeWorkerMessage[] = [];
  return {
    messages,
    postMessage: (message: BackendRuntimeWorkerMessage) => messages.push(message),
    on: (_event: "message", next_listener: (message: BackendRuntimeMainMessage) => void) => {
      listener = next_listener;
    },
    emit: (message: BackendRuntimeMainMessage) => listener?.(message),
    close: vi.fn(),
  } satisfies BackendRuntimePort & {
    messages: BackendRuntimeWorkerMessage[];
    emit: (message: BackendRuntimeMainMessage) => void;
  };
}

function get_host_request(
  port: { messages: BackendRuntimeWorkerMessage[] },
  kind: "resolve_proxy" | "open_output_folder",
): Extract<BackendRuntimeWorkerMessage, { type: "host_request" }> {
  const request = port.messages.findLast(
    (message): message is Extract<BackendRuntimeWorkerMessage, { type: "host_request" }> =>
      message.type === "host_request" && message.operation.kind === kind,
  );
  if (request === undefined) throw new Error(`缺少 ${kind} 宿主请求。`);
  return request;
}
