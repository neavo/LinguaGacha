import { afterEach, describe, expect, it, vi } from "vitest";

import {
  IPC_CHANNEL_OPEN_EXTERNAL_URL,
  IPC_CHANNEL_OPEN_LOG_WINDOW,
  IPC_CHANNEL_PICK_FIXED_PROJECT_DIRECTORY,
  IPC_CHANNEL_PICK_GLOSSARY_EXPORT_PATH,
  IPC_CHANNEL_PICK_GLOSSARY_IMPORT_FILE_PATH,
  IPC_CHANNEL_PICK_PROJECT_FILE_PATH,
  IPC_CHANNEL_PICK_PROJECT_SAVE_PATH,
  IPC_CHANNEL_PICK_PROJECT_SOURCE_DIRECTORY_PATH,
  IPC_CHANNEL_PICK_PROJECT_SOURCE_FILE_PATH,
  IPC_CHANNEL_PICK_PROMPT_EXPORT_FILE_PATH,
  IPC_CHANNEL_PICK_PROMPT_IMPORT_FILE_PATH,
  IPC_CHANNEL_PICK_WORKBENCH_FILE_PATH,
  IPC_CHANNEL_QUIT_APP,
  IPC_CHANNEL_RENDERER_DIAGNOSTICS,
  IPC_CHANNEL_TITLE_BAR_THEME,
} from "../gui-ipc-contract";

// electron mock 是测试级共享夹具，集中保存跨用例复用的 mock 状态。
const electron_mock = vi.hoisted(() => {
  type IpcEvent = { sender: unknown };
  type IpcListener = (event: IpcEvent, ...args: unknown[]) => unknown;
  type IpcInvokeHandler = (event: IpcEvent, ...args: unknown[]) => Promise<unknown> | unknown;

  const send_handlers = new Map<string, IpcListener>();
  const invoke_handlers = new Map<string, IpcInvokeHandler>();

  return {
    send_handlers,
    invoke_handlers,
    app_quit: vi.fn(),
    browser_window_from_web_contents: vi.fn(),
    show_open_dialog: vi.fn(),
    show_save_dialog: vi.fn(),
    open_external: vi.fn(),
    reset: () => {
      send_handlers.clear();
      invoke_handlers.clear();
    },
  };
});

// window handler mock 是测试级共享夹具，集中保存跨用例复用的 mock 状态。
const window_handler_mock = vi.hoisted(() => {
  return {
    sync_title_bar_overlay: vi.fn(),
  };
});

vi.mock("electron", () => {
  return {
    app: {
      quit: electron_mock.app_quit,
    },
    BrowserWindow: {
      fromWebContents: electron_mock.browser_window_from_web_contents,
    },
    dialog: {
      showOpenDialog: electron_mock.show_open_dialog,
      showSaveDialog: electron_mock.show_save_dialog,
    },
    ipcMain: {
      on: (channel: string, listener: (event: { sender: unknown }, ...args: unknown[]) => void) => {
        electron_mock.send_handlers.set(channel, listener);
      },
      handle: (
        channel: string,
        handler: (event: { sender: unknown }, ...args: unknown[]) => Promise<unknown> | unknown,
      ) => {
        electron_mock.invoke_handlers.set(channel, handler);
      },
    },
    shell: {
      openExternal: electron_mock.open_external,
    },
  };
});

vi.mock("./desktop-window-host", () => {
  return window_handler_mock;
});

describe("桌面 IPC 宿主", () => {
  afterEach(() => {
    electron_mock.reset();
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("标题栏主题、退出、日志窗口和外链 IPC 会执行对应宿主能力", async () => {
    const main_window = { id: "main-window" };
    const renderer_contents = { id: "renderer-contents" };
    const log_window_host = { toggle: vi.fn() };
    const mark_renderer_confirmed_app_quit = vi.fn();
    electron_mock.browser_window_from_web_contents.mockReturnValue(main_window);
    electron_mock.open_external.mockResolvedValue(undefined);
    await register_handlers({
      mainWindow: main_window,
      logWindowHost: log_window_host,
      markRendererConfirmedAppQuit: mark_renderer_confirmed_app_quit,
    });

    emit_send(IPC_CHANNEL_TITLE_BAR_THEME, { sender: renderer_contents }, "dark");
    await invoke(IPC_CHANNEL_QUIT_APP);
    await invoke(IPC_CHANNEL_OPEN_LOG_WINDOW);
    await invoke(IPC_CHANNEL_OPEN_EXTERNAL_URL, " https://example.com/docs ");

    expect(window_handler_mock.sync_title_bar_overlay).toHaveBeenCalledWith(main_window, "dark");
    expect(mark_renderer_confirmed_app_quit).toHaveBeenCalledTimes(1);
    expect(electron_mock.app_quit).toHaveBeenCalledTimes(1);
    expect(log_window_host.toggle).toHaveBeenCalledTimes(1);
    expect(electron_mock.open_external).toHaveBeenCalledWith("https://example.com/docs");
  });

  it("renderer 诊断 IPC 会按发送方交给诊断注册器", async () => {
    const renderer_contents = { id: "renderer-contents" };
    const record_renderer_diagnostics = vi.fn();
    const payload = {
      route: "workbench",
      event: {
        topic: "task.snapshot_changed",
      },
    };
    await register_handlers({
      recordRendererDiagnostics: record_renderer_diagnostics,
    });

    emit_send(IPC_CHANNEL_RENDERER_DIAGNOSTICS, { sender: renderer_contents }, payload);

    expect(record_renderer_diagnostics).toHaveBeenCalledWith(renderer_contents, payload);
  });

  it("外链 IPC 拒绝非 http 协议并且不交给系统浏览器", async () => {
    await register_handlers();

    await expect(invoke(IPC_CHANNEL_OPEN_EXTERNAL_URL, "file:///C:/secret.txt")).rejects.toThrow(
      "Only http and https URLs can be opened in the system browser.",
    );

    expect(electron_mock.open_external).not.toHaveBeenCalled();
  });

  it("打开路径类 IPC 返回路径快照并传递对应原生选择限制", async () => {
    const main_window = { id: "main-window" };
    await register_handlers({ mainWindow: main_window });
    electron_mock.show_open_dialog
      .mockResolvedValueOnce({ canceled: false, filePaths: ["C:/novel/a.txt", "C:/novel/b.txt"] })
      .mockResolvedValueOnce({ canceled: false, filePaths: ["C:/novel"] })
      .mockResolvedValueOnce({ canceled: false, filePaths: ["C:/project/demo.lg"] })
      .mockResolvedValueOnce({ canceled: false, filePaths: ["C:/project/new.txt"] })
      .mockResolvedValueOnce({ canceled: false, filePaths: ["C:/fixed"] })
      .mockResolvedValueOnce({ canceled: false, filePaths: ["C:/glossary.xlsx"] })
      .mockResolvedValueOnce({ canceled: false, filePaths: ["C:/prompt.txt"] });

    await expect(invoke(IPC_CHANNEL_PICK_PROJECT_SOURCE_FILE_PATH)).resolves.toEqual({
      canceled: false,
      paths: ["C:/novel/a.txt", "C:/novel/b.txt"],
    });
    await expect(invoke(IPC_CHANNEL_PICK_PROJECT_SOURCE_DIRECTORY_PATH)).resolves.toEqual({
      canceled: false,
      paths: ["C:/novel"],
    });
    await expect(invoke(IPC_CHANNEL_PICK_PROJECT_FILE_PATH)).resolves.toEqual({
      canceled: false,
      paths: ["C:/project/demo.lg"],
    });
    await expect(invoke(IPC_CHANNEL_PICK_WORKBENCH_FILE_PATH)).resolves.toEqual({
      canceled: false,
      paths: ["C:/project/new.txt"],
    });
    await expect(invoke(IPC_CHANNEL_PICK_FIXED_PROJECT_DIRECTORY, "C:/fixed")).resolves.toEqual({
      canceled: false,
      paths: ["C:/fixed"],
    });
    await expect(invoke(IPC_CHANNEL_PICK_GLOSSARY_IMPORT_FILE_PATH)).resolves.toEqual({
      canceled: false,
      paths: ["C:/glossary.xlsx"],
    });
    await expect(invoke(IPC_CHANNEL_PICK_PROMPT_IMPORT_FILE_PATH)).resolves.toEqual({
      canceled: false,
      paths: ["C:/prompt.txt"],
    });

    expect(electron_mock.show_open_dialog).toHaveBeenNthCalledWith(1, main_window, {
      properties: ["openFile", "multiSelections"],
    });
    expect(electron_mock.show_open_dialog).toHaveBeenNthCalledWith(2, main_window, {
      properties: ["openDirectory"],
    });
    expect(electron_mock.show_open_dialog).toHaveBeenNthCalledWith(3, main_window, {
      properties: ["openFile"],
      filters: [{ name: "LinguaGacha Project", extensions: ["lg"] }],
    });
    expect(electron_mock.show_open_dialog).toHaveBeenNthCalledWith(4, main_window, {
      properties: ["openFile", "multiSelections"],
    });
    expect(electron_mock.show_open_dialog).toHaveBeenNthCalledWith(5, main_window, {
      defaultPath: "C:/fixed",
      properties: ["openDirectory", "createDirectory"],
    });
    expect(electron_mock.show_open_dialog).toHaveBeenNthCalledWith(6, main_window, {
      properties: ["openFile"],
      filters: [
        { name: "支持的文件 (*.json *.xlsx)", extensions: ["json", "xlsx"] },
        { name: "JSON 文件 (*.json)", extensions: ["json"] },
        { name: "Excel 文件 (*.xlsx)", extensions: ["xlsx"] },
      ],
    });
    expect(electron_mock.show_open_dialog).toHaveBeenNthCalledWith(7, main_window, {
      properties: ["openFile"],
      filters: [{ name: "支持的文件 (*.txt)", extensions: ["txt"] }],
    });
  });

  it("保存路径类 IPC 返回单路径快照并只在有默认名时设置 defaultPath", async () => {
    const main_window = { id: "main-window" };
    await register_handlers({ mainWindow: main_window });
    electron_mock.show_save_dialog
      .mockResolvedValueOnce({ canceled: false, filePath: "C:/project/demo.lg" })
      .mockResolvedValueOnce({ canceled: false, filePath: "C:/glossary.json" })
      .mockResolvedValueOnce({ canceled: false, filePath: "C:/prompt.txt" })
      .mockResolvedValueOnce({ canceled: true });

    await expect(invoke(IPC_CHANNEL_PICK_PROJECT_SAVE_PATH, "demo.lg")).resolves.toEqual({
      canceled: false,
      paths: ["C:/project/demo.lg"],
    });
    await expect(invoke(IPC_CHANNEL_PICK_GLOSSARY_EXPORT_PATH, "glossary.json")).resolves.toEqual({
      canceled: false,
      paths: ["C:/glossary.json"],
    });
    await expect(invoke(IPC_CHANNEL_PICK_PROMPT_EXPORT_FILE_PATH)).resolves.toEqual({
      canceled: false,
      paths: ["C:/prompt.txt"],
    });
    await expect(invoke(IPC_CHANNEL_PICK_PROJECT_SAVE_PATH, "cancel.lg")).resolves.toEqual({
      canceled: true,
      paths: [],
    });

    expect(electron_mock.show_save_dialog).toHaveBeenNthCalledWith(1, main_window, {
      defaultPath: "demo.lg",
      filters: [{ name: "LinguaGacha Project", extensions: ["lg"] }],
    });
    expect(electron_mock.show_save_dialog).toHaveBeenNthCalledWith(2, main_window, {
      defaultPath: "glossary.json",
      filters: [{ name: "支持的文件 (*.json *.xlsx)", extensions: ["json", "xlsx"] }],
    });
    expect(electron_mock.show_save_dialog).toHaveBeenNthCalledWith(3, main_window, {
      filters: [{ name: "支持的文件 (*.txt)", extensions: ["txt"] }],
    });
    expect(electron_mock.show_save_dialog).toHaveBeenNthCalledWith(4, main_window, {
      defaultPath: "cancel.lg",
      filters: [{ name: "LinguaGacha Project", extensions: ["lg"] }],
    });
  });

  it("没有主窗口时仍能打开原生选择器并归一取消结果", async () => {
    await register_handlers({ mainWindow: null });
    electron_mock.show_open_dialog.mockResolvedValueOnce({ canceled: false, filePaths: [] });
    electron_mock.show_save_dialog.mockResolvedValueOnce({ canceled: true });

    await expect(invoke(IPC_CHANNEL_PICK_PROJECT_SOURCE_DIRECTORY_PATH)).resolves.toEqual({
      canceled: true,
      paths: [],
    });
    await expect(invoke(IPC_CHANNEL_PICK_PROMPT_EXPORT_FILE_PATH)).resolves.toEqual({
      canceled: true,
      paths: [],
    });

    expect(electron_mock.show_open_dialog).toHaveBeenCalledWith({
      properties: ["openDirectory"],
    });
    expect(electron_mock.show_save_dialog).toHaveBeenCalledWith({
      filters: [{ name: "支持的文件 (*.txt)", extensions: ["txt"] }],
    });
  });

  it("文件过滤器文案按调用时应用语言解析", async () => {
    let app_language = "EN";
    await register_handlers({
      readAppLanguage: () => app_language,
    });
    electron_mock.show_open_dialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ["C:/glossary.json"],
    });
    electron_mock.show_save_dialog.mockResolvedValueOnce({
      canceled: false,
      filePath: "C:/glossary.xlsx",
    });

    await expect(invoke(IPC_CHANNEL_PICK_GLOSSARY_IMPORT_FILE_PATH)).resolves.toEqual({
      canceled: false,
      paths: ["C:/glossary.json"],
    });
    app_language = "ZH";
    await expect(invoke(IPC_CHANNEL_PICK_GLOSSARY_EXPORT_PATH, "glossary.xlsx")).resolves.toEqual({
      canceled: false,
      paths: ["C:/glossary.xlsx"],
    });

    expect(electron_mock.show_open_dialog).toHaveBeenCalledWith({
      properties: ["openFile"],
      filters: [
        { name: "Supported files (*.json *.xlsx)", extensions: ["json", "xlsx"] },
        { name: "JSON files (*.json)", extensions: ["json"] },
        { name: "Excel files (*.xlsx)", extensions: ["xlsx"] },
      ],
    });
    expect(electron_mock.show_save_dialog).toHaveBeenCalledWith({
      defaultPath: "glossary.xlsx",
      filters: [{ name: "支持的文件 (*.json *.xlsx)", extensions: ["json", "xlsx"] }],
    });
  });
});

// register_handlers 收口测试中的共享步骤，保证断言只关注当前行为。
/**
 * 模拟 IPC 通信行为。
 */
async function register_handlers(
  options: {
    mainWindow?: unknown | null;
    logWindowHost?: { toggle: () => void } | null;
    markRendererConfirmedAppQuit?: () => void;
    recordRendererDiagnostics?: (sender: unknown, payload: unknown) => void;
    readAppLanguage?: () => unknown;
  } = {},
): Promise<void> {
  const { register_desktop_ipc_handlers } = await import("./desktop-ipc-host");
  register_desktop_ipc_handlers({
    getMainWindow: () => (options.mainWindow ?? null) as never,
    getLogWindowHost: () => (options.logWindowHost ?? null) as never,
    markRendererConfirmedAppQuit: options.markRendererConfirmedAppQuit ?? vi.fn(),
    recordRendererDiagnostics: (options.recordRendererDiagnostics ?? vi.fn()) as never,
    readAppLanguage: options.readAppLanguage ?? (() => "ZH"),
  });
}

// emit_send 收口测试中的共享步骤，保证断言只关注当前行为。
/**
 * 支撑当前测试场景的专用辅助逻辑。
 */
function emit_send(channel: string, event: { sender: unknown }, ...args: unknown[]): void {
  const listener = electron_mock.send_handlers.get(channel);
  if (listener === undefined) {
    throw new Error(`缺少 send 型 IPC 处理器：${channel}`);
  }
  listener(event, ...args);
}

// invoke 收口测试中的共享步骤，保证断言只关注当前行为。
/**
 * 模拟 IPC 通信行为。
 */
async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = electron_mock.invoke_handlers.get(channel);
  if (handler === undefined) {
    throw new Error(`缺少 invoke 型 IPC 处理器：${channel}`);
  }
  return await handler({ sender: { id: "renderer" } }, ...args);
}
