import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  BackendRuntimeHostOperation,
  BackendRuntimeMainMessage,
  BackendRuntimeWorkerMessage,
} from "../../shared/backend-runtime";
import { run_backend_runtime, type BackendRuntimePort } from "./backend-runtime";

const runtime_mocks = vi.hoisted(() => {
  const start = vi.fn();
  const stop = vi.fn(async () => undefined);
  const constructor_options: unknown[] = [];
  const runner_constructor_options: unknown[] = [];
  const log_manager = {
    warning: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  };
  const runner_initialize = vi.fn(async () => undefined);
  const runner_run = vi.fn(async () => ({ changed: 2 }));
  class DenoAgentWorkspaceRunner {
    constructor(options: unknown) {
      runner_constructor_options.push(options);
    }
    initialize = runner_initialize;
    run = runner_run;
  }
  class GuiBackendBootstrap {
    constructor(options: unknown) {
      constructor_options.push(options);
    }

    start = start;
    stop = stop;
  }
  return {
    GuiBackendBootstrap,
    DenoAgentWorkspaceRunner,
    constructor_options,
    log_manager,
    runner_initialize,
    runner_constructor_options,
    runner_run,
    start,
    stop,
  };
});

vi.mock("./gui-backend-bootstrap", () => ({
  GuiBackendBootstrap: runtime_mocks.GuiBackendBootstrap,
}));
vi.mock("../agent/workspace/runtime/runner", () => ({
  DenoAgentWorkspaceRunner: runtime_mocks.DenoAgentWorkspaceRunner,
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
    runtime_mocks.runner_constructor_options.length = 0;
    runtime_mocks.start.mockReset();
    runtime_mocks.stop.mockClear();
    runtime_mocks.log_manager.warning.mockClear();
    runtime_mocks.log_manager.error.mockClear();
    runtime_mocks.log_manager.fatal.mockClear();
    runtime_mocks.runner_initialize.mockClear();
    runtime_mocks.runner_run.mockClear();
    runtime_mocks.start.mockResolvedValue({
      apiBaseUrl: "http://127.0.0.1:4567",
      readAppLanguage: () => "EN",
      backendServices: {
        app: {
          paths: {
            get_berserker_update_root_dir: () => "E:/userdata/berserker",
          },
        },
        logManager: runtime_mocks.log_manager,
      },
    });
  });

  it("发布 ready，并通过结构化消息处理宿主能力与控制请求", async () => {
    const port = create_port();
    await run_backend_runtime({
      appRoot: "E:/app",
      builtinRoot: "E:/app.asar/builtin",
      moduleUrl: "file:///E:/app/dist-electron/backend-runtime-worker-entry.js",
      agentWorkspaceRuntime: runtime_paths(),
      port,
    });

    expect(port.messages[0]).toEqual({
      type: "ready",
      data: {
        apiBaseUrl: "http://127.0.0.1:4567",
        berserkerUpdateRootDir: "E:/userdata/berserker",
      },
    });
    const bootstrap_options = runtime_mocks.constructor_options[0] as {
      appRoot: string;
      builtinRoot: string;
      systemProxyResolver: { resolveProxy: (url: string) => Promise<string> };
      openOutputFolder: (path: string) => Promise<void>;
      agentWorkspaceRun: (request: unknown, signal: AbortSignal) => Promise<unknown>;
    };
    expect(bootstrap_options).toMatchObject({
      appRoot: "E:/app",
      builtinRoot: "E:/app.asar/builtin",
    });
    const proxy = bootstrap_options.systemProxyResolver.resolveProxy("https://example.com");
    const proxy_request = get_host_request(port, "resolve_proxy");
    port.emit({
      type: "host_response",
      requestId: proxy_request.requestId,
      result: { ok: true, data: "PROXY 127.0.0.1:7890" },
    });
    await expect(proxy).resolves.toBe("PROXY 127.0.0.1:7890");
    expect(runtime_mocks.runner_constructor_options[0]).toMatchObject({
      systemProxyResolver: bootstrap_options.systemProxyResolver,
    });

    const open = bootstrap_options.openOutputFolder("E:/output");
    const open_request = get_host_request(port, "open_output_folder");
    port.emit({
      type: "host_response",
      requestId: open_request.requestId,
      result: { ok: false, error: { message: "无法打开目录" } },
    });
    await expect(open).rejects.toThrow("无法打开目录");

    const workspace_signal = new AbortController().signal;
    const workspace = bootstrap_options.agentWorkspaceRun(
      {
        workspacePath: "E:/userdata/agent/workspace/run-1",
        script: "return { changed: 2 };",
      },
      workspace_signal,
    );
    await expect(workspace).resolves.toEqual({ changed: 2 });
    expect(runtime_mocks.runner_initialize).toHaveBeenCalledOnce();
    expect(runtime_mocks.runner_run).toHaveBeenCalledWith(
      { workspacePath: "E:/userdata/agent/workspace/run-1", script: "return { changed: 2 };" },
      workspace_signal,
    );

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

  it("取消宿主操作后等待清理回执，再以原始原因结算", async () => {
    const port = create_port();
    await run_backend_runtime({
      appRoot: "E:/app",
      builtinRoot: "E:/app.asar/builtin",
      moduleUrl: import.meta.url,
      agentWorkspaceRuntime: runtime_paths(),
      port,
    });
    const runner_options = runtime_mocks.runner_constructor_options[0] as {
      systemProxyResolver: { resolveProxy: (url: string, signal: AbortSignal) => Promise<string> };
    };
    const controller = new AbortController();
    const reason = new Error("用户停止 Agent");
    const proxy = runner_options.systemProxyResolver.resolveProxy(
      "https://example.com",
      controller.signal,
    );
    const request = get_host_request(port, "resolve_proxy");
    let settled = false;
    void proxy.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    controller.abort(reason);

    expect(port.messages).toContainEqual({ type: "host_cancel", requestId: request.requestId });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(() =>
      port.emit({
        type: "host_response",
        requestId: request.requestId,
        result: { ok: true, data: null },
      }),
    ).not.toThrow();
    await expect(proxy).rejects.toBe(reason);
  });

  it("runtime 关闭时取消并拒绝尚未结算的宿主请求", async () => {
    const port = create_port();
    await run_backend_runtime({
      appRoot: "E:/app",
      builtinRoot: "E:/app.asar/builtin",
      moduleUrl: import.meta.url,
      agentWorkspaceRuntime: runtime_paths(),
      port,
    });
    const bootstrap_options = runtime_mocks.constructor_options[0] as {
      openOutputFolder: (path: string) => Promise<void>;
    };
    const pending = bootstrap_options.openOutputFolder("E:/output");
    const rejection = expect(pending).rejects.toThrow("Backend runtime is closed.");
    const request = get_host_request(port, "open_output_folder");

    port.emit({ type: "stop", requestId: "stop-pending" });

    await rejection;
    await vi.waitFor(() => expect(port.close).toHaveBeenCalledOnce());
    expect(port.messages).toContainEqual({ type: "host_cancel", requestId: request.requestId });
  });

  it("启动失败时发送结构化错误、释放资源并关闭端口", async () => {
    runtime_mocks.start.mockRejectedValueOnce(new Error("端口占用"));
    const port = create_port();

    await run_backend_runtime({
      appRoot: "E:/app",
      builtinRoot: "E:/app.asar/builtin",
      moduleUrl: import.meta.url,
      agentWorkspaceRuntime: runtime_paths(),
      port,
    });

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

function runtime_paths() {
  return { denoExecutablePath: "E:/runtime/deno.exe", runtimeEntryPath: "E:/runtime/runner.js" };
}

function get_host_request(
  port: { messages: BackendRuntimeWorkerMessage[] },
  kind: BackendRuntimeHostOperation["kind"],
): Extract<BackendRuntimeWorkerMessage, { type: "host_request" }> {
  const request = port.messages.findLast(
    (message): message is Extract<BackendRuntimeWorkerMessage, { type: "host_request" }> =>
      message.type === "host_request" && message.operation.kind === kind,
  );
  if (request === undefined) throw new Error(`缺少 ${kind} 宿主请求。`);
  return request;
}
