import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (...args: unknown[]) => void;
type ReadyResolver = () => void;
type FakeWindow = { id: string };
type UnexpectedExitResult = { exitCode: number | null; signal: string | null };
type CoreLifecycleOptions = {
  appRoot: string;
  openOutputFolder: (output_path: string) => Promise<void>;
  onUnexpectedExit: (result: UnexpectedExitResult) => void;
};
type CoreLifecycleInstance = {
  options: CoreLifecycleOptions;
  start: () => Promise<{ baseUrl: string }>;
  stop: () => Promise<void>;
  isStopped: () => boolean;
};
type MainWindowOptions = {
  desktopBundleDir: string;
  coreApiBaseUrl: string;
  shouldBypassCloseConfirmation: () => boolean;
  onClosed: () => void;
};
type LogWindowOptions = {
  desktopBundleDir: string;
  coreApiBaseUrl: string;
};
type IpcHandlerOptions = {
  getMainWindow: () => FakeWindow | null;
  getLogWindowHost: () => { close: () => void } | null;
  markRendererConfirmedAppQuit: () => void;
};
type FatalHandlerOptions = {
  isAppShutdownInProgress: () => boolean;
  quitAfterCoreShutdown: (exit_code: number) => Promise<void>;
};

const MOCK_MODULES = [
  "electron",
  "./handler/ipc-handler",
  "./handler/window-handler",
  "./lifecycle/lifecycle-manager",
  "./lifecycle/main-fatal-error-handler",
  "./log/log-bridge",
  "./log/log-text",
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
  it("ready 后先启动 Core，再创建日志窗口、注册 IPC 并创建主窗口", async () => {
    const harness = create_index_harness();

    await harness.import_index();
    harness.resolve_ready();
    await flush_promises();

    expect(harness.calls.renderer_public_path_dirs).toHaveLength(1);
    expect(harness.calls.remote_debugging_configured).toBe(1);
    expect(harness.calls.core_managers).toHaveLength(1);
    expect(harness.calls.core_managers[0]?.options.appRoot).toBe(process.cwd());
    expect(harness.calls.log_window_options).toEqual([
      {
        desktopBundleDir: expect.any(String),
        coreApiBaseUrl: harness.base_url,
      },
    ]);
    expect(harness.calls.ipc_handler_options).toHaveLength(1);
    expect(harness.calls.main_window_options).toEqual([
      {
        desktopBundleDir: expect.any(String),
        coreApiBaseUrl: harness.base_url,
        shouldBypassCloseConfirmation: expect.any(Function),
        onClosed: expect.any(Function),
      },
    ]);
    expect(harness.calls.ipc_handler_options[0]?.getMainWindow()).toBe(
      harness.calls.created_windows[0],
    );
    expect(harness.calls.ipc_handler_options[0]?.getLogWindowHost()).toBe(harness.log_window_host);
    expect(harness.calls.main_window_options[0]?.shouldBypassCloseConfirmation()).toBe(false);

    harness.calls.ipc_handler_options[0]?.markRendererConfirmedAppQuit();

    expect(harness.calls.main_window_options[0]?.shouldBypassCloseConfirmation()).toBe(true);
  });

  it("before-quit 会阻止直接退出并先关闭 Core 生命周期", async () => {
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
    expect(harness.calls.core_stop_count).toBe(1);
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

  it("Core 启动失败时写入主进程日志、展示错误并退出应用", async () => {
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

  it("Core 意外退出时复用统一收尾路径并展示退出码与信号", async () => {
    const harness = create_index_harness();

    await harness.import_index();
    const manager = harness.calls.core_managers[0];
    manager?.options.onUnexpectedExit({ exitCode: null, signal: "SIGTERM" });
    await flush_promises();

    expect(harness.calls.show_error_boxes).toEqual([
      ["后端服务异常退出", "后端服务已提前退出，应用将关闭。\n退出码：null\n信号：SIGTERM"],
    ]);
    expect(harness.calls.core_stop_count).toBe(1);
    expect(harness.calls.app_exit_codes).toEqual([1]);
  });

  it("打开输出目录失败时把 shell 错误转换为文件域异常", async () => {
    const harness = create_index_harness();
    harness.set_open_path_result("系统拒绝访问");

    await harness.import_index();
    const manager = harness.calls.core_managers[0];

    await expect(manager?.options.openOutputFolder("E:/Novel/out")).rejects.toThrow(
      "file.io_failed",
    );
  });
});

function create_index_harness(): {
  base_url: string;
  log_window_host: { close: () => void };
  calls: {
    app_exit_codes: number[];
    app_quit_count: number;
    core_managers: CoreLifecycleInstance[];
    core_start_count: number;
    core_stop_count: number;
    created_windows: FakeWindow[];
    fatal_handler_options: FatalHandlerOptions[];
    ipc_handler_options: IpcHandlerOptions[];
    log_window_close_count: number;
    log_window_options: LogWindowOptions[];
    main_errors: Array<{ message: string; context: Record<string, unknown> }>;
    main_window_options: MainWindowOptions[];
    remote_debugging_configured: number;
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
  const calls = {
    app_exit_codes: [] as number[],
    app_quit_count: 0,
    core_managers: [] as CoreLifecycleInstance[],
    core_start_count: 0,
    core_stop_count: 0,
    created_windows: [] as FakeWindow[],
    fatal_handler_options: [] as FatalHandlerOptions[],
    ipc_handler_options: [] as IpcHandlerOptions[],
    log_window_close_count: 0,
    log_window_options: [] as LogWindowOptions[],
    main_errors: [] as Array<{ message: string; context: Record<string, unknown> }>,
    main_window_options: [] as MainWindowOptions[],
    remote_debugging_configured: 0,
    renderer_public_path_dirs: [] as string[],
    show_error_boxes: [] as Array<[string, string]>,
  };

  class FakeCoreLifecycleManager implements CoreLifecycleInstance {
    public readonly options: CoreLifecycleOptions;
    private stopped = false;

    public constructor(options: CoreLifecycleOptions) {
      this.options = options;
      calls.core_managers.push(this);
    }

    public async start(): Promise<{ baseUrl: string }> {
      calls.core_start_count += 1;
      if (start_error !== null) {
        throw start_error;
      }
      return { baseUrl: base_url };
    }

    public async stop(): Promise<void> {
      calls.core_stop_count += 1;
      this.stopped = true;
    }

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
      dialog: {
        showErrorBox: (title: string, message: string) => {
          calls.show_error_boxes.push([title, message]);
        },
      },
      shell: {
        openPath: async () => open_path_result,
      },
    };
  });

  vi.doMock("./handler/ipc-handler", () => {
    return {
      register_desktop_ipc_handlers: (options: IpcHandlerOptions) => {
        calls.ipc_handler_options.push(options);
      },
    };
  });

  vi.doMock("./handler/window-handler", () => {
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

  vi.doMock("./lifecycle/lifecycle-manager", () => {
    return {
      CoreLifecycleManager: FakeCoreLifecycleManager,
    };
  });

  vi.doMock("./lifecycle/main-fatal-error-handler", () => {
    return {
      install_main_fatal_error_handler: (options: FatalHandlerOptions) => {
        calls.fatal_handler_options.push(options);
      },
    };
  });

  vi.doMock("./log/log-bridge", () => {
    return {
      write_electron_main_error: (message: string, context: Record<string, unknown>) => {
        calls.main_errors.push({ message, context });
      },
    };
  });

  vi.doMock("./log/log-text", () => {
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
      await import("./index");
    },
    log_window_host,
    resolve_ready,
    set_open_path_result: (result) => {
      open_path_result = result;
    },
    set_start_error: (error) => {
      start_error = error;
    },
  };
}

async function flush_promises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
