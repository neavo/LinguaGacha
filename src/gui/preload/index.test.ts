import { afterEach, describe, expect, it, vi } from "vitest";

import {
  IPC_CHANNEL_OPEN_LOG_WINDOW,
  IPC_CHANNEL_QUIT_APP,
  IPC_CHANNEL_RENDERER_DIAGNOSTICS,
  IPC_CHANNEL_TITLE_BAR_THEME,
  IPC_CHANNEL_WINDOW_CLOSE_REQUEST,
} from "../gui-ipc-contract";
import { DESKTOP_BRIDGE_GLOBAL_NAME, type DesktopBridgeApi } from "../bridge/bridge-api";

// electron mock 是测试级共享夹具，集中保存跨用例复用的 mock 状态。
const electron_mock = vi.hoisted(() => {
  return {
    exposed_name: "",
    exposed_api: null as DesktopBridgeApi | null,
    send: vi.fn(),
    invoke: vi.fn(),
    on: vi.fn(),
    remove_listener: vi.fn(),
    get_path_for_file: vi.fn(() => "E:/demo/source.txt"),
  };
});

vi.mock("electron", () => {
  return {
    contextBridge: {
      exposeInMainWorld: (name: string, api: DesktopBridgeApi) => {
        electron_mock.exposed_name = name;
        electron_mock.exposed_api = api;
      },
    },
    ipcRenderer: {
      send: electron_mock.send,
      invoke: electron_mock.invoke,
      on: electron_mock.on,
      removeListener: electron_mock.remove_listener,
    },
    webUtils: {
      getPathForFile: electron_mock.get_path_for_file,
    },
  };
});

describe("preload desktop bridge", () => {
  const original_argv = [...process.argv]; // original_argv 用于还原 preload 参数解析上下文

  afterEach(() => {
    process.argv = [...original_argv];
    electron_mock.exposed_name = "";
    electron_mock.exposed_api = null;
    vi.clearAllMocks();
    vi.resetModules();
  });

  /**
   * 带 Backend API 启动参数加载 preload 模块，模拟 main 创建窗口时的真实 argv。
   */
  async function import_preload_with_backend_api_arg(): Promise<void> {
    process.argv = [...original_argv.slice(0, 2), "--backend-api-base-url=http://127.0.0.1:7788"];
    await import("./index");
  }

  it("向 renderer 暴露受控桌面桥接 API", async () => {
    await import_preload_with_backend_api_arg();
    const bridge = electron_mock.exposed_api;
    if (bridge === null) {
      throw new Error("preload 未暴露 desktop bridge。");
    }

    expect(bridge.backendApi.baseUrl).toBe("http://127.0.0.1:7788");
    expect(bridge.getPathForFile({} as File)).toBe("E:/demo/source.txt");
    bridge.setTitleBarTheme("dark");
    await bridge.quitApp();
    await bridge.openLogWindow();
    bridge.reportRendererDiagnostics({ route: "workbench" });

    expect(electron_mock.get_path_for_file).toHaveBeenCalledTimes(1);
    expect(electron_mock.send).toHaveBeenCalledWith(IPC_CHANNEL_TITLE_BAR_THEME, "dark");
    expect(electron_mock.invoke).toHaveBeenCalledWith(IPC_CHANNEL_QUIT_APP);
    expect(electron_mock.invoke).toHaveBeenCalledWith(IPC_CHANNEL_OPEN_LOG_WINDOW);
    expect(electron_mock.send).toHaveBeenCalledWith(IPC_CHANNEL_RENDERER_DIAGNOSTICS, {
      route: "workbench",
    });
  });

  it("关闭请求订阅返回对应解除函数", async () => {
    await import_preload_with_backend_api_arg();
    const bridge = electron_mock.exposed_api;
    if (bridge === null) {
      throw new Error("preload 未暴露 desktop bridge。");
    }

    const callback = vi.fn();
    const unsubscribe = bridge.onWindowCloseRequest(callback);
    const listener = electron_mock.on.mock.calls[0]?.[1] as (() => void) | undefined;
    listener?.();
    unsubscribe();

    expect(electron_mock.on).toHaveBeenCalledWith(IPC_CHANNEL_WINDOW_CLOSE_REQUEST, listener);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(electron_mock.remove_listener).toHaveBeenCalledWith(
      IPC_CHANNEL_WINDOW_CLOSE_REQUEST,
      listener,
    );
  });

  it("使用固定全局名暴露 API", async () => {
    await import_preload_with_backend_api_arg();

    expect(electron_mock.exposed_name).toBe(DESKTOP_BRIDGE_GLOBAL_NAME);
    expect(electron_mock.exposed_api).not.toBeNull();
  });
});
