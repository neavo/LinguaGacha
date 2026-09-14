import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  BackendRuntimeHostOperation,
  BackendRuntimeMainMessage,
  BackendRuntimeWorkerMessage,
} from "../../shared/backend-runtime";
import { run_backend_runtime, type BackendRuntimePort } from "./backend-runtime";

const RUNTIME_ENTRY_PATH = "E:/runtime/runtime.mjs";

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
  const runner_run = vi.fn(async () => ({ changed: 2 }));
  /** 隔离脚本进程，保留运行和注入选项的观察入口。 */
  class AgentWorkspaceRunner {
    /** 记录宿主注入，验证脚本沿正式 runner 端口执行。 */
    constructor(options: unknown) {
      runner_constructor_options.push(options);
    }
    run = runner_run;
  }
  /** 由测试决定启动和关闭结果，验证 worker 协议的生命周期。 */
  class GuiBackendBootstrap {
    /** 捕获组合根依赖，允许测试直接触发宿主回调。 */
    constructor(options: unknown) {
      constructor_options.push(options);
    }

    start = start;
    stop = stop;
  }
  return {
    GuiBackendBootstrap,
    AgentWorkspaceRunner,
    constructor_options,
    log_manager,
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
  AgentWorkspaceRunner: runtime_mocks.AgentWorkspaceRunner,
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
    runtime_mocks.runner_run.mockClear();
    runtime_mocks.start.mockResolvedValue({
      apiBaseUrl: "http://127.0.0.1:4567",
      readAppLanguage: () => "EN",
      backendServices: {
        app: {
          metadata: { read_version: () => "1.2.3" },
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
      agentWorkspaceRuntimeEntryPath: RUNTIME_ENTRY_PATH,
      port,
    });

    expect(port.messages[0]).toEqual({
      type: "ready",
      data: {
        apiBaseUrl: "http://127.0.0.1:4567",
        berserkerUpdateRootDir: "E:/userdata/berserker",
        appVersion: "1.2.3",
      },
    });
    const bootstrap_options = runtime_mocks.constructor_options[0] as {
      appRoot: string;
      builtinRoot: string;
      systemProxyResolver: { resolveProxy: (url: string) => Promise<string> };
      openDirectory: (path: string) => Promise<void>;
      pickSavePath: (name: string) => Promise<string | null>;
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

    const open = bootstrap_options.openDirectory("E:/output");
    const open_request = get_host_request(port, "open_directory");
    port.emit({
      type: "host_response",
      requestId: open_request.requestId,
      result: { ok: false, error: { message: "无法打开目录" } },
    });
    await expect(open).rejects.toThrow("无法打开目录");

    for (const destination of ["E:/结果.md", null]) {
      const saved = bootstrap_options.pickSavePath("结果.md");
      const save_request = get_host_request(port, "pick_save_path");
      expect(save_request.operation).toEqual({ kind: "pick_save_path", defaultName: "结果.md" });
      port.emit({
        type: "host_response",
        requestId: save_request.requestId,
        result: { ok: true, data: destination },
      });
      await expect(saved).resolves.toBe(destination);
    }

    const workspace_signal = new AbortController().signal;
    const workspace = bootstrap_options.agentWorkspaceRun(
      {
        workspacePath: "E:/userdata/agent/workspace/run-1",
        script: "return { changed: 2 };",
      },
      workspace_signal,
    );
    await expect(workspace).resolves.toEqual({ changed: 2 });
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

  it("取消宿主等待立即以原始原因结算，迟到响应无效", async () => {
    const port = create_port();
    await run_backend_runtime({
      appRoot: "E:/app",
      builtinRoot: "E:/app.asar/builtin",
      moduleUrl: import.meta.url,
      agentWorkspaceRuntimeEntryPath: RUNTIME_ENTRY_PATH,
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
    const rejection = expect(proxy).rejects.toBe(reason);
    controller.abort(reason);
    await rejection;
    expect(() =>
      port.emit({
        type: "host_response",
        requestId: request.requestId,
        result: { ok: true, data: null },
      }),
    ).not.toThrow();
    await expect(proxy).rejects.toBe(reason);
  });

  it("runtime 关闭时拒绝尚未结算的保存请求", async () => {
    const port = create_port();
    await run_backend_runtime({
      appRoot: "E:/app",
      builtinRoot: "E:/app.asar/builtin",
      moduleUrl: import.meta.url,
      agentWorkspaceRuntimeEntryPath: RUNTIME_ENTRY_PATH,
      port,
    });
    const bootstrap_options = runtime_mocks.constructor_options[0] as {
      openDirectory: (path: string) => Promise<void>;
      pickSavePath: (name: string) => Promise<string | null>;
    };
    const pending = bootstrap_options.pickSavePath("report.md");
    const rejection = expect(pending).rejects.toThrow("Backend runtime is closed.");

    port.emit({ type: "stop", requestId: "stop-pending" });

    await rejection;
    await vi.waitFor(() => expect(port.close).toHaveBeenCalledOnce());
  });

  it("启动失败时发送结构化错误、释放资源并关闭端口", async () => {
    runtime_mocks.start.mockRejectedValueOnce(new Error("端口占用"));
    const port = create_port();

    await run_backend_runtime({
      appRoot: "E:/app",
      builtinRoot: "E:/app.asar/builtin",
      moduleUrl: import.meta.url,
      agentWorkspaceRuntimeEntryPath: RUNTIME_ENTRY_PATH,
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

/** 用同步消息投递驱动 worker，保留其向 main 发出的完整消息。 */
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

/** 按操作类型取得宿主请求，避免测试依赖随机 requestId。 */
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
