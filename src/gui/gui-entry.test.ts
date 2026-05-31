import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BackendWorkerExecution } from "../backend/worker/worker-execution";

type Listener = (...args: unknown[]) => void;
type ReadyResolver = () => void;
type FakeWindow = { id: string };
type BackendBootstrapOptions = {
  appRoot: string;
  exposeApiGateway: boolean;
  systemProxyResolver?: { resolveProxy: (url: string) => Promise<string> };
  openOutputFolder: (output_path: string) => Promise<void>;
  workerExecution: BackendWorkerExecution;
};
type BackendBootstrapInstance = {
  options: BackendBootstrapOptions;
  start: () => Promise<{
    apiBaseUrl: string | null;
    readAppLanguage: () => unknown;
    systemProxyStartupNotice: SystemProxyStartupNotice;
  }>;
  stop: () => Promise<void>;
  isStopped: () => boolean;
};
type SystemProxyStartupNotice = {
  detected: boolean; // 测试只关心入口层是否把脱敏提示摘要继续传给窗口宿主
  proxiedOriginCount: number; // 命中数量帮助断言摘要没有被入口层重新计算
  proxyDisplay: string | null; // URL 展示值必须由 Backend 生成，GUI 入口不重新解析代理
};
type MainWindowOptions = {
  desktopBundleDir: string;
  backendApiBaseUrl: string;
  systemProxyStartupNotice: SystemProxyStartupNotice;
  rendererDiagnostics: RendererDiagnosticsRegistry;
  shouldBypassCloseConfirmation: () => boolean;
  onClosed: () => void;
};
type LogWindowOptions = {
  desktopBundleDir: string;
  backendApiBaseUrl: string;
  systemProxyStartupNotice: SystemProxyStartupNotice;
  rendererDiagnostics: RendererDiagnosticsRegistry;
};
type IpcHandlerOptions = {
  getMainWindow: () => FakeWindow | null;
  getLogWindowHost: () => { close: () => void } | null;
  markRendererConfirmedAppQuit: () => void;
  recordRendererDiagnostics: (...args: unknown[]) => void;
  readAppLanguage: () => unknown;
};
type FatalHandlerOptions = {
  isAppShutdownInProgress: () => boolean;
  quitAfterBackendShutdown: (exit_code: number) => Promise<void>;
};
type RendererDiagnosticsRegistry = {
  registerWindow: (...args: unknown[]) => void;
  recordRendererDiagnostics: (...args: unknown[]) => void;
  buildRendererProcessGoneContext: (...args: unknown[]) => Record<string, unknown>;
  buildWindowUnresponsiveContext: (...args: unknown[]) => Record<string, unknown>;
};

// MOCK MODULES 是测试级共享夹具，集中保存跨用例复用的 mock 状态。
const MOCK_MODULES = [
  "electron",
  "./shell/desktop-ipc-host",
  "./shell/desktop-window-host",
  "./shell/renderer-process-diagnostics",
  "./shell/native-error-dialog",
  "../backend/bootstrap/backend-bootstrap",
  "./shell/main-fatal-error-handler",
  "../backend/log/log-bridge",
  "../backend/log/log-text",
] as const;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  for (const module_id of MOCK_MODULES) {
    vi.doUnmock(module_id);
  }
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("Electron main 入口", () => {
  it("ready 后先启动 Backend，再创建日志窗口、注册 IPC 并创建主窗口", async () => {
    const harness = create_index_harness();

    await harness.import_index();
    harness.resolve_ready();
    await flush_promises();

    expect(harness.calls.renderer_public_path_dirs).toHaveLength(1);
    expect(harness.calls.remote_debugging_configured).toBe(1);
    expect(harness.calls.renderer_crash_reporting_configured).toBe(1);
    expect(harness.calls.renderer_diagnostics_registry_count).toBe(1);
    expect(harness.calls.backend_bootstraps).toHaveLength(1);
    expect(harness.calls.backend_bootstraps[0]?.options.appRoot).toBe(process.cwd());
    expect(harness.calls.backend_bootstraps[0]?.options.exposeApiGateway).toBe(true);
    await expect(
      harness.calls.backend_bootstraps[0]?.options.systemProxyResolver?.resolveProxy(
        "https://api.example/v1",
      ),
    ).resolves.toBe("DIRECT");
    expect(harness.calls.proxy_resolve_urls).toEqual(["https://api.example/v1"]);
    expect(harness.calls.backend_bootstraps[0]?.options.workerExecution).toEqual(
      create_test_worker_execution(),
    );
    expect(harness.calls.log_window_options).toEqual([
      {
        desktopBundleDir: expect.any(String),
        backendApiBaseUrl: harness.base_url,
        systemProxyStartupNotice: harness.system_proxy_startup_notice,
        rendererDiagnostics: harness.renderer_process_diagnostics,
      },
    ]);
    expect(harness.calls.ipc_handler_options).toHaveLength(1);
    expect(harness.calls.main_window_options).toEqual([
      {
        desktopBundleDir: expect.any(String),
        backendApiBaseUrl: harness.base_url,
        systemProxyStartupNotice: harness.system_proxy_startup_notice,
        rendererDiagnostics: harness.renderer_process_diagnostics,
        shouldBypassCloseConfirmation: expect.any(Function),
        onClosed: expect.any(Function),
      },
    ]);
    expect(harness.calls.ipc_handler_options[0]?.getMainWindow()).toBe(
      harness.calls.created_windows[0],
    );
    expect(harness.calls.ipc_handler_options[0]?.readAppLanguage()).toBe("ZH");
    expect(harness.calls.ipc_handler_options[0]?.getLogWindowHost()).toBe(harness.log_window_host);
    expect(harness.calls.ipc_handler_options[0]?.recordRendererDiagnostics).toBe(
      harness.renderer_process_diagnostics.recordRendererDiagnostics,
    );
    expect(harness.calls.main_window_options[0]?.shouldBypassCloseConfirmation()).toBe(false);

    harness.calls.ipc_handler_options[0]?.markRendererConfirmedAppQuit();

    expect(harness.calls.main_window_options[0]?.shouldBypassCloseConfirmation()).toBe(true);
  });

  it("before-quit 会阻止直接退出并先关闭 Backend 生命周期", async () => {
    const harness = create_index_harness();
    let prevented = false;

    await harness.import_index();
    harness.emit("before-quit", {
      preventDefault: () => {
        prevented = true;
      },
    });
    await flush_promises();

    expect(prevented).toBe(true);
    expect(harness.calls.backend_stop_count).toBe(1);
    expect(harness.calls.app_exit_codes).toEqual([0]);
  });

  it("所有窗口关闭时会关闭日志窗口并触发应用退出", async () => {
    const harness = create_index_harness();

    await harness.import_index();
    harness.resolve_ready();
    await flush_promises();
    harness.emit("window-all-closed");

    expect(harness.calls.log_window_close_count).toBe(1);
    expect(harness.calls.app_quit_count).toBe(1);
  });

  it("Backend 启动失败时写入主进程日志、展示错误并退出应用", async () => {
    const harness = create_index_harness();
    const start_error = new Error("端口不可用");
    harness.set_start_error(start_error);

    await harness.import_index();
    harness.resolve_ready();
    await flush_promises();

    expect(harness.calls.main_errors).toEqual([
      {
        message: "log:app.diagnostic.lifecycle.app_start_failed",
        context: { error: start_error },
      },
    ]);
    expect(harness.calls.show_error_boxes).toEqual([["LinguaGacha 启动失败", "端口不可用"]]);
    expect(harness.calls.app_exit_codes).toEqual([1]);
  });

  it("打开输出目录失败时把 shell 错误转换为文件域异常", async () => {
    const harness = create_index_harness();
    harness.set_open_path_result("系统拒绝访问");

    await harness.import_index();
    const manager = harness.calls.backend_bootstraps[0];

    await expect(manager?.options.openOutputFolder("E:/Novel/out")).rejects.toThrow(
      "file.io_failed",
    );
  });
});

/**
 * 搭建 Electron main 入口测试夹具，用假的 app、窗口和 BackendBootstrap 观察启动顺序。
 */
function create_index_harness(): {
  base_url: string;
  log_window_host: { close: () => void };
  renderer_process_diagnostics: RendererDiagnosticsRegistry;
  system_proxy_startup_notice: SystemProxyStartupNotice;
  calls: {
    app_exit_codes: number[];
    app_quit_count: number;
    backend_bootstraps: BackendBootstrapInstance[];
    backend_start_count: number;
    backend_stop_count: number;
    created_windows: FakeWindow[];
    fatal_handler_options: FatalHandlerOptions[];
    ipc_handler_options: IpcHandlerOptions[];
    log_window_close_count: number;
    log_window_options: LogWindowOptions[];
    main_errors: Array<{ message: string; context: Record<string, unknown> }>;
    main_window_options: MainWindowOptions[];
    proxy_resolve_urls: string[];
    remote_debugging_configured: number;
    renderer_crash_reporting_configured: number;
    renderer_diagnostics_registry_count: number;
    renderer_public_path_dirs: string[];
    show_error_boxes: Array<[string, string]>;
  };
  emit: (event_name: string, ...args: unknown[]) => void;
  import_index: () => Promise<void>;
  resolve_ready: ReadyResolver;
  set_open_path_result: (result: string) => void;
  set_start_error: (error: Error) => void;
} {
  const base_url = "http://127.0.0.1:19001";
  const system_proxy_startup_notice: SystemProxyStartupNotice = {
    detected: true,
    proxiedOriginCount: 2,
    proxyDisplay: "http://127.0.0.1:7890",
  }; // system_proxy_startup_notice 模拟 BackendBootstrap 返回的启动期代理摘要
  const listeners = new Map<string, Listener[]>();
  let resolve_ready: ReadyResolver = () => undefined;
  const ready_promise = new Promise<void>((resolve) => {
    resolve_ready = resolve;
  });
  let open_path_result = "";
  let start_error: Error | null = null;
  const log_window_host = {
    close: () => {
      calls.log_window_close_count += 1;
    },
  };
  const renderer_process_diagnostics: RendererDiagnosticsRegistry = {
    registerWindow: vi.fn(),
    recordRendererDiagnostics: vi.fn(),
    buildRendererProcessGoneContext: vi.fn(() => ({})),
    buildWindowUnresponsiveContext: vi.fn(() => ({})),
  };
  const calls = {
    app_exit_codes: [] as number[],
    app_quit_count: 0,
    backend_bootstraps: [] as BackendBootstrapInstance[],
    backend_start_count: 0,
    backend_stop_count: 0,
    created_windows: [] as FakeWindow[],
    fatal_handler_options: [] as FatalHandlerOptions[],
    ipc_handler_options: [] as IpcHandlerOptions[],
    log_window_close_count: 0,
    log_window_options: [] as LogWindowOptions[],
    main_errors: [] as Array<{ message: string; context: Record<string, unknown> }>,
    main_window_options: [] as MainWindowOptions[],
    proxy_resolve_urls: [] as string[],
    remote_debugging_configured: 0,
    renderer_crash_reporting_configured: 0,
    renderer_diagnostics_registry_count: 0,
    renderer_public_path_dirs: [] as string[],
    show_error_boxes: [] as Array<[string, string]>,
  };

  // 模拟外部运行时对象，只保留当前测试会触发的行为面。
  class FakeBackendBootstrap implements BackendBootstrapInstance {
    public readonly options: BackendBootstrapOptions;
    private stopped = false;

    // 构造阶段只注入必要依赖，避免实例创建时读取外部可变状态。
    public constructor(options: BackendBootstrapOptions) {
      this.options = options;
      calls.backend_bootstraps.push(this);
    }

    // start 模拟测试场景中的对应运行时方法，保持断言聚焦协议行为。
    public async start(): Promise<{
      apiBaseUrl: string;
      readAppLanguage: () => unknown;
      systemProxyStartupNotice: SystemProxyStartupNotice;
    }> {
      calls.backend_start_count += 1;
      if (start_error !== null) {
        throw start_error;
      }
      return {
        apiBaseUrl: base_url,
        readAppLanguage: () => "ZH",
        systemProxyStartupNotice: system_proxy_startup_notice,
      };
    }

    // stop 模拟测试场景中的对应运行时方法，保持断言聚焦协议行为。
    public async stop(): Promise<void> {
      calls.backend_stop_count += 1;
      this.stopped = true;
    }

    // isStopped 模拟测试场景中的对应运行时方法，保持断言聚焦协议行为。
    public isStopped(): boolean {
      return this.stopped;
    }
  }

  vi.doMock("electron", () => {
    return {
      app: {
        isPackaged: false,
        commandLine: {
          appendSwitch: () => undefined,
        },
        exit: (exit_code: number) => {
          calls.app_exit_codes.push(exit_code);
        },
        on: (event_name: string, listener: Listener) => {
          const event_listeners = listeners.get(event_name) ?? [];
          event_listeners.push(listener);
          listeners.set(event_name, event_listeners);
        },
        quit: () => {
          calls.app_quit_count += 1;
        },
        whenReady: () => ready_promise,
      },
      BrowserWindow: {
        getAllWindows: () => calls.created_windows,
      },
      shell: {
        openPath: async () => open_path_result,
      },
      session: {
        defaultSession: {
          resolveProxy: async (url: string) => {
            calls.proxy_resolve_urls.push(url);
            return "DIRECT";
          },
        },
      },
    };
  });

  vi.doMock("./shell/desktop-ipc-host", () => {
    return {
      register_desktop_ipc_handlers: (options: IpcHandlerOptions) => {
        calls.ipc_handler_options.push(options);
      },
    };
  });

  vi.doMock("./shell/desktop-window-host", () => {
    return {
      configure_development_remote_debugging: () => {
        calls.remote_debugging_configured += 1;
      },
      configure_renderer_public_path: (desktop_bundle_dir: string) => {
        calls.renderer_public_path_dirs.push(desktop_bundle_dir);
      },
      create_log_window_host: (options: LogWindowOptions) => {
        calls.log_window_options.push(options);
        return log_window_host;
      },
      create_main_window: (options: MainWindowOptions) => {
        calls.main_window_options.push(options);
        const window = { id: `window-${calls.created_windows.length.toString()}` };
        calls.created_windows.push(window);
        return window;
      },
    };
  });

  vi.doMock("./shell/renderer-process-diagnostics", () => {
    return {
      configure_renderer_crash_reporting: () => {
        calls.renderer_crash_reporting_configured += 1;
      },
      create_renderer_process_diagnostics_registry: () => {
        calls.renderer_diagnostics_registry_count += 1;
        return renderer_process_diagnostics;
      },
    };
  });

  vi.doMock("./shell/native-error-dialog", () => {
    return {
      show_native_error_dialog: (title: string, message: string) => {
        calls.show_error_boxes.push([title, message]);
      },
    };
  });

  vi.doMock("../backend/bootstrap/backend-bootstrap", () => {
    return {
      BackendBootstrap: FakeBackendBootstrap,
    };
  });

  vi.doMock("./shell/main-fatal-error-handler", () => {
    return {
      install_main_fatal_error_handler: (options: FatalHandlerOptions) => {
        calls.fatal_handler_options.push(options);
      },
    };
  });

  vi.doMock("../backend/log/log-bridge", () => {
    return {
      write_electron_main_error: (message: string, context: Record<string, unknown>) => {
        calls.main_errors.push({ message, context });
      },
    };
  });

  vi.doMock("../backend/log/log-text", () => {
    return {
      t_main_log: (key: string) => `log:${key}`,
    };
  });

  return {
    base_url,
    calls,
    emit: (event_name, ...args) => {
      for (const listener of listeners.get(event_name) ?? []) {
        listener(...args);
      }
    },
    import_index: async () => {
      const entry = await import("./gui-entry");
      entry.run_gui_entry({
        desktopBundleDir: path.join(process.cwd(), "build", "dist-electron"),
        workerExecution: create_test_worker_execution(),
      });
    },
    log_window_host,
    renderer_process_diagnostics,
    resolve_ready,
    system_proxy_startup_notice,
    set_open_path_result: (result) => {
      open_path_result = result;
    },
    set_start_error: (error) => {
      start_error = error;
    },
  };
}

/**
 * 构造 GUI 启动测试使用的 Backend worker 执行配置，断言入口层会原样传入 BackendBootstrap。
 */
function create_test_worker_execution(): BackendWorkerExecution {
  return {
    kind: "worker_threads",
    workUnitWorkerEntryUrl: pathToFileURL(
      path.join(process.cwd(), "build", "dist-electron", "work-unit-worker-entry.js"),
    ),
    planningWorkerEntryUrl: pathToFileURL(
      path.join(process.cwd(), "build", "dist-electron", "planning-worker-entry.js"),
    ),
    backendWorkerEntryUrl: pathToFileURL(
      path.join(process.cwd(), "build", "dist-electron", "backend-worker-entry.js"),
    ),
  };
}

/**
 * 刷新入口异步链路中的 ready、start 和窗口创建微任务。
 */
async function flush_promises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
