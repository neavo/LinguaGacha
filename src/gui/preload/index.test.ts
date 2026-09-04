import { afterEach, describe, expect, it, vi } from "vitest";

import {
  IPC_CHANNEL_OPEN_LOG_WINDOW,
  IPC_CHANNEL_PICK_PATH,
  IPC_CHANNEL_QUIT_APP,
  IPC_CHANNEL_REQUEST_USER_ATTENTION,
  IPC_CHANNEL_RENDERER_DIAGNOSTICS,
  IPC_CHANNEL_TITLE_BAR_THEME,
  IPC_CHANNEL_UPDATE_DOWNLOAD_PROGRESS,
  IPC_CHANNEL_UPDATE_DOWNLOAD_RELEASE,
  IPC_CHANNEL_UPDATE_LAUNCH_BERSERKER,
  IPC_CHANNEL_WINDOW_CLOSE_REQUEST,
} from "../gui-ipc-contract";
import { DESKTOP_BRIDGE_GLOBAL_NAME, type DesktopBridgeApi } from "../bridge/bridge-api";

const LAST_DIALOG_DIRECTORY_STORAGE_KEY = "linguagacha:dialog:last-directory-workaround";

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
  const original_argv = [...process.argv]; // 用于还原 preload 参数解析上下文

  afterEach(() => {
    process.argv = [...original_argv];
    electron_mock.exposed_name = "";
    electron_mock.exposed_api = null;
    vi.restoreAllMocks();
    localStorage.clear();
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

    expect(electron_mock.exposed_name).toBe(DESKTOP_BRIDGE_GLOBAL_NAME);
    expect(bridge.backendApi.baseUrl).toBe("http://127.0.0.1:7788");
    expect(bridge.getPathForFile({} as File)).toBe("E:/demo/source.txt");
    bridge.setTitleBarTheme("dark");
    bridge.requestUserAttention();
    await bridge.quitApp();
    await bridge.openLogWindow();
    bridge.reportRendererDiagnostics({ route: "workbench" });
    electron_mock.invoke.mockResolvedValueOnce({ status: "fallback_to_release_page" });
    await bridge.downloadUpdate(
      {
        latest_version: "1.2.4",
        release_url: "https://github.com/neavo/LinguaGacha/releases/tag/v1.2.4",
        windows_zip_urls: {},
      },
      vi.fn(),
    );
    await bridge.launchUpdate({
      latest_version: "1.2.4",
      zip_path: "E:/LinguaGacha/userdata/berserker/v1.2.4/LinguaGacha_v1.2.4_Windows_x64.zip",
    });

    expect(electron_mock.get_path_for_file).toHaveBeenCalledTimes(1);
    expect(electron_mock.send).toHaveBeenCalledWith(IPC_CHANNEL_TITLE_BAR_THEME, "dark");
    expect(electron_mock.send).toHaveBeenCalledWith(IPC_CHANNEL_REQUEST_USER_ATTENTION);
    expect(electron_mock.invoke).toHaveBeenCalledWith(IPC_CHANNEL_QUIT_APP);
    expect(electron_mock.invoke).toHaveBeenCalledWith(IPC_CHANNEL_OPEN_LOG_WINDOW);
    expect(electron_mock.invoke).toHaveBeenCalledWith(
      IPC_CHANNEL_UPDATE_DOWNLOAD_RELEASE,
      expect.objectContaining({
        latest_version: "1.2.4",
        request_id: "update-download-1",
        windows_zip_urls: {},
      }),
    );
    expect(electron_mock.invoke).toHaveBeenCalledWith(IPC_CHANNEL_UPDATE_LAUNCH_BERSERKER, {
      latest_version: "1.2.4",
      zip_path: "E:/LinguaGacha/userdata/berserker/v1.2.4/LinguaGacha_v1.2.4_Windows_x64.zip",
    });
    expect(electron_mock.send).toHaveBeenCalledWith(IPC_CHANNEL_RENDERER_DIAGNOSTICS, {
      route: "workbench",
    });
  });

  it("所有路径选择共用浏览器本地最近目录且取消时不覆盖", async () => {
    await import_preload_with_backend_api_arg();
    const bridge = electron_mock.exposed_api;
    if (bridge === null) {
      throw new Error("preload 未暴露 desktop bridge。");
    }
    electron_mock.invoke
      .mockResolvedValueOnce({ canceled: false, paths: ["E:/novel/a.txt"] })
      .mockResolvedValueOnce({ canceled: false, paths: ["D:/projects"] })
      .mockResolvedValueOnce({ canceled: true, paths: [] });

    await bridge.pickProjectSourceFilePath();
    expect(electron_mock.invoke).toHaveBeenNthCalledWith(1, IPC_CHANNEL_PICK_PATH, {
      kind: "project-source-files",
      default_directory: null,
    });
    expect(localStorage.getItem(LAST_DIALOG_DIRECTORY_STORAGE_KEY)).toBe("E:/novel");

    await bridge.pickProjectSourceDirectoryPath();
    expect(electron_mock.invoke).toHaveBeenNthCalledWith(2, IPC_CHANNEL_PICK_PATH, {
      kind: "project-source-directory",
      default_directory: "E:/novel",
    });
    expect(localStorage.getItem(LAST_DIALOG_DIRECTORY_STORAGE_KEY)).toBe("D:/projects");

    await bridge.pickPromptImportFilePath();
    expect(localStorage.getItem(LAST_DIALOG_DIRECTORY_STORAGE_KEY)).toBe("D:/projects");
  });

  it("浏览器本地存储不可用时仍正常完成路径选择", async () => {
    await import_preload_with_backend_api_arg();
    const bridge = electron_mock.exposed_api;
    if (bridge === null) {
      throw new Error("preload 未暴露 desktop bridge。");
    }
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    electron_mock.invoke.mockResolvedValueOnce({
      canceled: false,
      paths: ["E:/project/demo.lg"],
    });

    await expect(bridge.pickProjectFilePath()).resolves.toEqual({
      canceled: false,
      paths: ["E:/project/demo.lg"],
    });
    expect(electron_mock.invoke).toHaveBeenCalledWith(IPC_CHANNEL_PICK_PATH, {
      kind: "project-file",
      default_directory: null,
    });
  });

  it("下载更新只转发同一 request id 的进度并在完成后解绑监听", async () => {
    await import_preload_with_backend_api_arg();
    const bridge = electron_mock.exposed_api;
    if (bridge === null) {
      throw new Error("preload 未暴露 desktop bridge。");
    }

    electron_mock.invoke.mockImplementationOnce(async () => {
      const listener = electron_mock.on.mock.calls[0]?.[1] as
        | ((event: unknown, progress: unknown) => void)
        | undefined;
      listener?.({}, { request_id: "other-request", progress_percent: 7 });
      listener?.({}, { request_id: "update-download-1", progress_percent: 45.5 });
      return {
        status: "downloaded",
        latest_version: "1.2.4",
        release_url: "release",
        zip_path: "zip",
      };
    });
    const progress_values: number[] = [];

    await bridge.downloadUpdate(
      {
        latest_version: "1.2.4",
        release_url: "release",
        windows_zip_urls: {
          x64: "https://example.com/LinguaGacha_v1.2.4_Windows_x64.zip",
        },
      },
      (progress) => {
        progress_values.push(progress.progress_percent);
      },
    );

    expect(progress_values).toEqual([45.5]);
    expect(electron_mock.on).toHaveBeenCalledWith(
      IPC_CHANNEL_UPDATE_DOWNLOAD_PROGRESS,
      expect.any(Function),
    );
    expect(electron_mock.remove_listener).toHaveBeenCalledWith(
      IPC_CHANNEL_UPDATE_DOWNLOAD_PROGRESS,
      expect.any(Function),
    );
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
});
