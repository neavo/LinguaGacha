import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BackendRuntimeReady } from "../shared/backend-runtime";
import type { DesktopUpdateServiceOptions } from "./shell/desktop-update-service";
import { run_gui_entry } from "./gui-entry";

const mocks = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;
  const app_listeners = new Map<string, Listener>();
  const backend_instances: Record<string, unknown>[] = [];
  const ready: BackendRuntimeReady = {
    apiBaseUrl: "http://127.0.0.1:4567",
    berserkerUpdateRootDir: "E:/userdata/berserker",
    systemProxyStartupNotice: { detected: false, proxiedOriginCount: 0, proxyDisplay: null },
  };
  const backend_start = vi.fn(async () => ready);
  const backend_stop = vi.fn(async () => undefined);
  const backend_read_language = vi.fn(async () => "ZH");
  const backend_record_diagnostic = vi.fn(async () => undefined);
  let backend_stopped = false;

  class BackendRuntimeClient {
    constructor(readonly options: Record<string, unknown>) {
      backend_instances.push(options);
    }

    start = backend_start;
    stop = vi.fn(async () => {
      backend_stopped = true;
      await backend_stop();
    });
    readAppLanguage = backend_read_language;
    recordHostDiagnostic = backend_record_diagnostic;
    isStopped = () => backend_stopped;
  }

  const cleanup_updates = vi.fn(async () => undefined);
  const update_options: DesktopUpdateServiceOptions[] = [];
  class DesktopUpdateService {
    constructor(options: DesktopUpdateServiceOptions) {
      update_options.push(options);
    }

    cleanup_berserker_version_dirs = cleanup_updates;
  }

  return {
    app_listeners,
    backend_instances,
    ready,
    backend_start,
    backend_stop,
    backend_read_language,
    backend_record_diagnostic,
    reset_backend_stopped: () => {
      backend_stopped = false;
    },
    BackendRuntimeClient,
    DesktopUpdateService,
    update_options,
    cleanup_updates,
    app_exit: vi.fn(),
    app_quit: vi.fn(),
    resolve_proxy: vi.fn(async () => "DIRECT"),
    session_fetch: vi.fn(async () => new Response()),
    open_path: vi.fn(async () => ""),
    configure_public_path: vi.fn(),
    configure_debugging: vi.fn(),
    configure_crash_reporting: vi.fn(),
    create_main_window: vi.fn(() => ({ kind: "main" })),
    create_log_window_host: vi.fn(() => ({ close: vi.fn() })),
    register_ipc: vi.fn(),
    install_fatal_handler: vi.fn(),
    show_native_error: vi.fn(),
  };
});

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      mocks.app_listeners.set(event, listener);
    }),
    whenReady: vi.fn(() => Promise.resolve()),
    exit: mocks.app_exit,
    quit: mocks.app_quit,
  },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  session: {
    defaultSession: { fetch: mocks.session_fetch, resolveProxy: mocks.resolve_proxy },
  },
  shell: { openPath: mocks.open_path },
}));
vi.mock("./runtime/backend-runtime-client", () => ({
  BackendRuntimeClient: mocks.BackendRuntimeClient,
}));
vi.mock("./shell/desktop-update-service", () => ({
  DesktopUpdateService: mocks.DesktopUpdateService,
}));
vi.mock("./shell/desktop-ipc-host", () => ({
  register_desktop_ipc_handlers: mocks.register_ipc,
}));
vi.mock("./shell/desktop-window-host", () => ({
  configure_renderer_public_path: mocks.configure_public_path,
  configure_development_remote_debugging: mocks.configure_debugging,
  create_main_window: mocks.create_main_window,
  create_log_window_host: mocks.create_log_window_host,
}));
vi.mock("./shell/main-fatal-error-handler", () => ({
  install_main_fatal_error_handler: mocks.install_fatal_handler,
}));
vi.mock("./shell/native-error-dialog", () => ({
  try_show_native_error_dialog: mocks.show_native_error,
}));
vi.mock("./shell/renderer-process-diagnostics", () => ({
  configure_renderer_crash_reporting: mocks.configure_crash_reporting,
  create_renderer_process_diagnostics_registry: () => ({
    recordRendererDiagnostics: vi.fn(),
  }),
}));

describe("run_gui_entry", () => {
  beforeEach(() => {
    mocks.app_listeners.clear();
    mocks.backend_instances.length = 0;
    mocks.update_options.length = 0;
    mocks.reset_backend_stopped();
    vi.clearAllMocks();
    mocks.backend_start.mockResolvedValue(mocks.ready);
  });

  it("Backend ready 后以 Electron 默认会话装配更新器、IPC 和窗口", async () => {
    const worker_url = new URL("file:///backend-runtime-worker-entry.js");

    run_gui_entry({
      desktopBundleDir: "E:/app/dist-electron",
      backendRuntimeWorkerEntryUrl: worker_url,
    });
    await vi.waitFor(() => expect(mocks.create_main_window).toHaveBeenCalledOnce());

    expect(mocks.backend_instances[0]).toMatchObject({
      workerEntryUrl: worker_url,
      appRoot: process.cwd(),
    });
    expect(mocks.update_options).toEqual([
      {
        appRoot: process.cwd(),
        updateRootDir: "E:/userdata/berserker",
        runtime: { fetch: expect.any(Function) },
      },
    ]);
    const update_fetch = mocks.update_options[0]?.runtime.fetch;
    if (update_fetch === undefined) throw new Error("缺少更新器 fetch。");
    const update_request_init = { method: "GET" };
    await update_fetch("https://example.com/update.zip", update_request_init);
    expect(mocks.session_fetch).toHaveBeenCalledWith(
      "https://example.com/update.zip",
      update_request_init,
    );
    expect(mocks.cleanup_updates).toHaveBeenCalledOnce();
    expect(mocks.create_log_window_host).toHaveBeenCalledWith(
      expect.objectContaining({ backendApiBaseUrl: "http://127.0.0.1:4567" }),
    );
    expect(mocks.register_ipc).toHaveBeenCalledOnce();
    const ipc_options = mocks.register_ipc.mock.calls[0]?.[0] as {
      readAppLanguage: () => Promise<unknown>;
    };
    await expect(ipc_options.readAppLanguage()).resolves.toBe("ZH");
  });

  it("Backend 完整就绪前不注册 macOS 恢复窗口入口", async () => {
    const start_completion: { resolve: ((ready: BackendRuntimeReady) => void) | null } = {
      resolve: null,
    };
    mocks.backend_start.mockImplementationOnce(
      () =>
        new Promise<BackendRuntimeReady>((resolve) => {
          start_completion.resolve = resolve;
        }),
    );

    run_gui_entry({
      desktopBundleDir: "E:/app/dist-electron",
      backendRuntimeWorkerEntryUrl: new URL("file:///backend-runtime-worker-entry.js"),
    });
    await vi.waitFor(() => expect(mocks.backend_start).toHaveBeenCalledOnce());
    expect(mocks.app_listeners.has("activate")).toBe(false);

    if (start_completion.resolve === null) throw new Error("缺少 Backend start resolver。");
    start_completion.resolve(mocks.ready);
    await vi.waitFor(() => expect(mocks.create_main_window).toHaveBeenCalledOnce());
    expect(mocks.app_listeners.has("activate")).toBe(true);
  });

  it("before-quit 先阻止原生退出，等待 Backend 停止后再退出", async () => {
    run_gui_entry({
      desktopBundleDir: "E:/app/dist-electron",
      backendRuntimeWorkerEntryUrl: new URL("file:///backend-runtime-worker-entry.js"),
    });
    await vi.waitFor(() => expect(mocks.create_main_window).toHaveBeenCalledOnce());
    const prevent_default = vi.fn();
    const before_quit = mocks.app_listeners.get("before-quit");
    if (before_quit === undefined) throw new Error("缺少 before-quit listener。");

    before_quit({ preventDefault: prevent_default });
    await vi.waitFor(() => expect(mocks.app_exit).toHaveBeenCalledWith(0));

    expect(prevent_default).toHaveBeenCalledOnce();
    expect(mocks.backend_stop).toHaveBeenCalledOnce();
    expect(mocks.backend_stop.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.app_exit.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it("Backend 意外退出时显示原生错误并走故障退出码", async () => {
    run_gui_entry({
      desktopBundleDir: "E:/app/dist-electron",
      backendRuntimeWorkerEntryUrl: new URL("file:///backend-runtime-worker-entry.js"),
    });
    await vi.waitFor(() => expect(mocks.create_main_window).toHaveBeenCalledOnce());
    const on_unexpected_exit = mocks.backend_instances[0]?.["onUnexpectedExit"] as
      | ((error: Error) => void)
      | undefined;
    if (on_unexpected_exit === undefined) throw new Error("缺少 Backend 异常退出处理器。");

    on_unexpected_exit(new Error("worker gone"));
    await vi.waitFor(() => expect(mocks.app_exit).toHaveBeenCalledWith(1));

    expect(mocks.show_native_error).toHaveBeenCalledWith("LinguaGacha 后端异常退出", "worker gone");
  });
});
