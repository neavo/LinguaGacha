import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import path from "node:path";

import {
  IPC_CHANNEL_OPEN_EXTERNAL_URL,
  IPC_CHANNEL_OPEN_LOG_WINDOW,
  IPC_CHANNEL_PICK_PATH,
  IPC_CHANNEL_QUIT_APP,
  IPC_CHANNEL_REQUEST_USER_ATTENTION,
  IPC_CHANNEL_RENDERER_DIAGNOSTICS,
  IPC_CHANNEL_TITLE_BAR_THEME,
  IPC_CHANNEL_UPDATE_DOWNLOAD_PROGRESS,
  IPC_CHANNEL_UPDATE_DOWNLOAD_RELEASE,
  IPC_CHANNEL_UPDATE_LAUNCH_BERSERKER,
} from "../gui-ipc-contract";
import {
  type DesktopPathPickIpcRequest,
  type DesktopPathPickResult,
  type DesktopRendererDiagnosticsPayload,
  type DesktopUpdateDownloadIpcRequest,
  type DesktopUpdateDownloadProgress,
  type DesktopUpdateDownloadResult,
  type DesktopUpdateLaunchRequest,
  type DesktopUpdateLaunchResult,
  type ResolvedThemeMode,
} from "../bridge/bridge-types";
import { type LogWindowHost } from "./log-window-host";
import { sync_title_bar_overlay } from "./desktop-window-host";
import { resolve_app_locale } from "../../domain/app-language";
import { create_text_resolver, type TextResolver } from "../../shared/i18n";

export type DesktopIpcHandlerOptions = {
  getMainWindow: () => BrowserWindow | null;
  getLogWindowHost: () => LogWindowHost | null;
  markRendererConfirmedAppQuit: () => void;
  recordRendererDiagnostics: (
    sender: Electron.WebContents,
    payload: DesktopRendererDiagnosticsPayload,
  ) => void; // 诊断载荷由 main 注册器统一清洗，IPC 层只保持 sender 归属
  readAppLanguage: () => Promise<unknown>; // 原生系统对话框文案必须跟随当前应用语言
  updateService: {
    download_release: (
      request: DesktopUpdateDownloadIpcRequest,
      report_progress: (progress: DesktopUpdateDownloadProgress) => void,
    ) => Promise<DesktopUpdateDownloadResult>;
    launch_berserker: (request: DesktopUpdateLaunchRequest) => Promise<DesktopUpdateLaunchResult>;
  };
  quitAfterBackendShutdown: (exit_code: number) => Promise<void>;
};

/**
 * 注册 preload 暴露给 renderer 的桌面宿主能力
 */
export function register_desktop_ipc_handlers(options: DesktopIpcHandlerOptions): void {
  // renderer 主题变化通过 preload 转发到 main，再同步给原生标题栏 Overlay
  ipcMain.on(IPC_CHANNEL_TITLE_BAR_THEME, (event, theme_mode: ResolvedThemeMode) => {
    sync_title_bar_overlay(BrowserWindow.fromWebContents(event.sender), theme_mode);
  });

  // renderer 运行态面包屑写入 main 内存，覆盖 Chromium 原生崩溃时 HTTP 上报来不及发出的场景
  ipcMain.on(
    IPC_CHANNEL_RENDERER_DIAGNOSTICS,
    (event, payload: DesktopRendererDiagnosticsPayload) => {
      options.recordRendererDiagnostics(event.sender, payload);
    },
  );

  // 长任务结束时只由 main 按窗口焦点决定是否播放提示并闪烁任务栏
  ipcMain.on(IPC_CHANNEL_REQUEST_USER_ATTENTION, (event) => {
    request_user_attention(BrowserWindow.fromWebContents(event.sender));
  });

  // renderer 已完成自己的关闭确认后，主窗口 close 事件不再二次拦截
  ipcMain.handle(IPC_CHANNEL_QUIT_APP, async () => {
    options.markRendererConfirmedAppQuit();
    app.quit();
  });

  // 侧栏日志入口只触发宿主显隐，日志数据仍由日志页面通过 SSE 订阅
  ipcMain.handle(IPC_CHANNEL_OPEN_LOG_WINDOW, async () => {
    options.getLogWindowHost()?.toggle();
  });

  // 外链统一交给系统外部处理程序；URL 语义与可用性由宿主和系统处理
  ipcMain.handle(IPC_CHANNEL_OPEN_EXTERNAL_URL, async (_event, url: string) => {
    await shell.openExternal(url);
  });

  // 更新包下载和进度只在 main 执行，renderer 通过 request_id 消费自身那一次进度。
  ipcMain.handle(
    IPC_CHANNEL_UPDATE_DOWNLOAD_RELEASE,
    async (event, request: DesktopUpdateDownloadIpcRequest) => {
      return await options.updateService.download_release(request, (progress) => {
        event.sender.send(IPC_CHANNEL_UPDATE_DOWNLOAD_PROGRESS, progress);
      });
    },
  );

  // 外部更新器启动成功后进入统一 Backend 收尾路径。
  ipcMain.handle(
    IPC_CHANNEL_UPDATE_LAUNCH_BERSERKER,
    async (_event, request: DesktopUpdateLaunchRequest) => {
      const result = await options.updateService.launch_berserker(request);
      void options.quitAfterBackendShutdown(0);
      return result;
    },
  );

  ipcMain.handle(IPC_CHANNEL_PICK_PATH, async (_event, request: DesktopPathPickIpcRequest) => {
    return pick_path(options, request);
  });
}

/**
 * 未聚焦窗口才需要打扰用户；闪烁停止由窗口统一 focus 事件负责。
 */
function request_user_attention(target_window: BrowserWindow | null): void {
  if (target_window === null || target_window.isDestroyed() || target_window.isFocused()) {
    return;
  }

  shell.beep();
  target_window.flashFrame(true);
}

/**
 * 系统文件选择器不经过 renderer，本地化文案在打开瞬间读取当前设置。
 */
async function create_dialog_text_resolver(
  options: DesktopIpcHandlerOptions,
): Promise<TextResolver> {
  return create_text_resolver(resolve_app_locale(await options.readAppLanguage()));
}

/**
 * .lg 是项目文件的唯一桌面选择入口，和导入源文件选择保持分离。
 */
function build_project_file_filters(t: TextResolver): Electron.FileFilter[] {
  return [
    {
      name: t("app.native_file_filter.project"),
      extensions: ["lg"],
    },
  ];
}

/**
 * 术语导入只开放当前 Backend 能稳定解析的结构化格式。
 */
function build_glossary_import_file_filters(t: TextResolver): Electron.FileFilter[] {
  return [
    {
      name: t("app.native_file_filter.supported_json_xlsx_files"),
      extensions: ["json", "xlsx"],
    },
    {
      name: t("app.native_file_filter.json_files"),
      extensions: ["json"],
    },
    {
      name: t("app.native_file_filter.excel_files"),
      extensions: ["xlsx"],
    },
  ];
}

/**
 * 术语导出沿用导入格式集合，调用方再决定具体后缀。
 */
function build_glossary_export_file_filters(t: TextResolver): Electron.FileFilter[] {
  return [
    {
      name: t("app.native_file_filter.supported_json_xlsx_files"),
      extensions: ["json", "xlsx"],
    },
  ];
}

/**
 * Prompt 只以纯文本进出，避免主进程承担格式转换。
 */
function build_prompt_file_filters(t: TextResolver): Electron.FileFilter[] {
  return [
    {
      name: t("app.native_file_filter.supported_txt_files"),
      extensions: ["txt"],
    },
  ];
}

/**
 * 把 renderer 的路径选择意图集中翻译为 Electron 原生对话框参数。
 */
async function pick_path(
  options: DesktopIpcHandlerOptions,
  request: DesktopPathPickIpcRequest,
): Promise<DesktopPathPickResult> {
  const main_window = options.getMainWindow();
  switch (request.kind) {
    case "project-source-files":
      return pick_open_path(main_window, request.default_directory, {
        properties: ["openFile", "multiSelections"],
      });
    case "project-source-directory":
      return pick_open_path(main_window, request.default_directory, {
        properties: ["openDirectory"],
      });
    case "project-file":
      return pick_open_path(main_window, request.default_directory, {
        properties: ["openFile"],
        filters: build_project_file_filters(await create_dialog_text_resolver(options)),
      });
    case "project-save":
      return pick_save_path(
        main_window,
        request.default_directory,
        request.default_name,
        build_project_file_filters(await create_dialog_text_resolver(options)),
      );
    case "workbench-files":
      return pick_open_path(main_window, request.default_directory, {
        properties: ["openFile", "multiSelections"],
      });
    case "fixed-project-directory":
      return pick_open_path(
        main_window,
        typeof request.default_path === "string" && request.default_path !== ""
          ? request.default_path
          : request.default_directory,
        { properties: ["openDirectory", "createDirectory"] },
      );
    case "glossary-import":
      return pick_open_path(main_window, request.default_directory, {
        properties: ["openFile"],
        filters: build_glossary_import_file_filters(await create_dialog_text_resolver(options)),
      });
    case "glossary-export":
      return pick_save_path(
        main_window,
        request.default_directory,
        request.default_name,
        build_glossary_export_file_filters(await create_dialog_text_resolver(options)),
      );
    case "prompt-import":
      return pick_open_path(main_window, request.default_directory, {
        properties: ["openFile"],
        filters: build_prompt_file_filters(await create_dialog_text_resolver(options)),
      });
    case "prompt-export":
      return pick_save_path(
        main_window,
        request.default_directory,
        "",
        build_prompt_file_filters(await create_dialog_text_resolver(options)),
      );
    default:
      throw new TypeError("Unsupported desktop path picker kind.");
  }
}

/**
 * 打开文件或目录选择框，统一返回 preload 能安全传递的轻量结果对象
 */
async function pick_open_path(
  main_window: BrowserWindow | null,
  default_path: string | null,
  options: Electron.OpenDialogOptions,
): Promise<DesktopPathPickResult> {
  const dialog_options =
    default_path === null || default_path === ""
      ? options
      : { ...options, defaultPath: default_path };
  const result =
    main_window === null
      ? await dialog.showOpenDialog(dialog_options)
      : await dialog.showOpenDialog(main_window, dialog_options);
  return {
    canceled: result.canceled || result.filePaths.length === 0,
    paths: result.filePaths,
  };
}

/**
 * 打开保存路径选择框；空 default_name 表示只使用系统默认目录
 */
async function pick_save_path(
  main_window: BrowserWindow | null,
  default_directory: string | null,
  default_name: string,
  filters: Electron.FileFilter[],
): Promise<DesktopPathPickResult> {
  const dialog_options: Electron.SaveDialogOptions = {
    filters,
  };
  if (default_directory !== null && default_directory !== "") {
    dialog_options.defaultPath =
      default_name === "" ? default_directory : path.join(default_directory, default_name);
  } else if (default_name !== "") {
    dialog_options.defaultPath = default_name;
  }
  const result =
    main_window === null
      ? await dialog.showSaveDialog(dialog_options)
      : await dialog.showSaveDialog(main_window, dialog_options);

  return {
    canceled: result.canceled || result.filePath === undefined,
    paths: result.filePath === undefined ? [] : [result.filePath],
  };
}
