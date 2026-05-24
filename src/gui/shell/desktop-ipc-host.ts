import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";

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
} from "../ipc/ipc-contract";
import { resolve_external_url } from "./external-url-policy";
import {
  type DesktopPathPickResult,
  type DesktopRendererDiagnosticsPayload,
  type ThemeMode,
} from "../bridge/bridge-types";
import { type LogWindowHost } from "./log-window-host";
import { sync_title_bar_overlay } from "./desktop-window-host";
import { create_text_resolver, resolve_i18n_locale, type TextResolver } from "../../shared/i18n";

export type DesktopIpcHandlerOptions = {
  getMainWindow: () => BrowserWindow | null;
  getLogWindowHost: () => LogWindowHost | null;
  markRendererConfirmedAppQuit: () => void;
  recordRendererDiagnostics: (
    sender: Electron.WebContents,
    payload: DesktopRendererDiagnosticsPayload,
  ) => void; // 诊断载荷由 main 注册器统一清洗，IPC 层只保持 sender 归属
  readAppLanguage: () => unknown; // 原生系统对话框文案必须跟随当前应用语言
};

/**
 * 注册 preload 暴露给 renderer 的桌面宿主能力
 */
export function register_desktop_ipc_handlers(options: DesktopIpcHandlerOptions): void {
  // renderer 主题变化通过 preload 转发到 main，再同步给原生标题栏 Overlay
  ipcMain.on(IPC_CHANNEL_TITLE_BAR_THEME, (event, theme_mode: ThemeMode) => {
    sync_title_bar_overlay(BrowserWindow.fromWebContents(event.sender), theme_mode);
  });

  // renderer 运行态面包屑写入 main 内存，覆盖 Chromium 原生崩溃时 HTTP 上报来不及发出的场景
  ipcMain.on(
    IPC_CHANNEL_RENDERER_DIAGNOSTICS,
    (event, payload: DesktopRendererDiagnosticsPayload) => {
      options.recordRendererDiagnostics(event.sender, payload);
    },
  );

  // renderer 已完成自己的关闭确认后，主窗口 close 事件不再二次拦截
  ipcMain.handle(IPC_CHANNEL_QUIT_APP, async () => {
    options.markRendererConfirmedAppQuit();
    app.quit();
  });

  // 侧栏日志入口只触发宿主显隐，日志数据仍由日志页面通过 SSE 订阅
  ipcMain.handle(IPC_CHANNEL_OPEN_LOG_WINDOW, async () => {
    options.getLogWindowHost()?.toggle();
  });

  // 外链统一交给系统浏览器，主进程负责协议白名单校验
  ipcMain.handle(IPC_CHANNEL_OPEN_EXTERNAL_URL, async (_event, url: string) => {
    await shell.openExternal(resolve_external_url(url));
  });

  // 新建项目源文件允许多选，具体格式校验留给 Core / renderer 流程
  ipcMain.handle(IPC_CHANNEL_PICK_PROJECT_SOURCE_FILE_PATH, async () => {
    return pick_open_path(options.getMainWindow(), {
      properties: ["openFile", "multiSelections"],
    });
  });

  // 新建项目源目录只选择目录，保持文件和目录入口在 UI 上可区分
  ipcMain.handle(IPC_CHANNEL_PICK_PROJECT_SOURCE_DIRECTORY_PATH, async () => {
    return pick_open_path(options.getMainWindow(), {
      properties: ["openDirectory"],
    });
  });

  // 打开已有项目只允许选择 .lg 文件
  ipcMain.handle(IPC_CHANNEL_PICK_PROJECT_FILE_PATH, async () => {
    const t = create_dialog_text_resolver(options);
    return pick_open_path(options.getMainWindow(), {
      properties: ["openFile"],
      filters: build_project_file_filters(t),
    });
  });

  // 保存项目时沿用 .lg 文件过滤器，默认文件名由 renderer 按项目语义生成
  ipcMain.handle(IPC_CHANNEL_PICK_PROJECT_SAVE_PATH, async (_event, default_name: string) => {
    return pick_save_path(
      options.getMainWindow(),
      default_name,
      build_project_file_filters(create_dialog_text_resolver(options)),
    );
  });

  // 工作台追加文件允许多选，后续去重和解析由项目流程处理
  ipcMain.handle(IPC_CHANNEL_PICK_WORKBENCH_FILE_PATH, async () => {
    return pick_open_path(options.getMainWindow(), {
      properties: ["openFile", "multiSelections"],
    });
  });

  // 固定工程目录允许创建目录，便于用户直接在选择器里补齐目标位置
  ipcMain.handle(
    IPC_CHANNEL_PICK_FIXED_PROJECT_DIRECTORY,
    async (_event, default_path?: string) => {
      return pick_open_path(options.getMainWindow(), {
        defaultPath:
          typeof default_path === "string" && default_path !== "" ? default_path : undefined,
        properties: ["openDirectory", "createDirectory"],
      });
    },
  );

  // 术语导入只选择单个结构化文件，批量合并语义不放在原生选择层
  ipcMain.handle(IPC_CHANNEL_PICK_GLOSSARY_IMPORT_FILE_PATH, async () => {
    const t = create_dialog_text_resolver(options);
    return pick_open_path(options.getMainWindow(), {
      properties: ["openFile"],
      filters: build_glossary_import_file_filters(t),
    });
  });

  // 术语导出通过保存对话框决定路径，实际序列化格式由后续流程根据后缀处理
  ipcMain.handle(IPC_CHANNEL_PICK_GLOSSARY_EXPORT_PATH, async (_event, default_name: string) => {
    return pick_save_path(
      options.getMainWindow(),
      default_name,
      build_glossary_export_file_filters(create_dialog_text_resolver(options)),
    );
  });

  // Prompt 导入只读纯文本文件，避免主进程承担格式转换
  ipcMain.handle(IPC_CHANNEL_PICK_PROMPT_IMPORT_FILE_PATH, async () => {
    const t = create_dialog_text_resolver(options);
    return pick_open_path(options.getMainWindow(), {
      properties: ["openFile"],
      filters: build_prompt_file_filters(t),
    });
  });

  // Prompt 导出不预设文件名，由 renderer 或系统保存面板提供最终命名
  ipcMain.handle(IPC_CHANNEL_PICK_PROMPT_EXPORT_FILE_PATH, async () => {
    return pick_save_path(
      options.getMainWindow(),
      "",
      build_prompt_file_filters(create_dialog_text_resolver(options)),
    );
  });
}

/**
 * 系统文件选择器不经过 renderer，本地化文案在打开瞬间读取当前设置。
 */
function create_dialog_text_resolver(options: DesktopIpcHandlerOptions): TextResolver {
  return create_text_resolver(resolve_i18n_locale(options.readAppLanguage()));
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
 * 术语导入只开放当前 Core 能稳定解析的结构化格式。
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
 * 打开文件或目录选择框，统一返回 preload 能安全传递的轻量结果对象
 */
async function pick_open_path(
  main_window: BrowserWindow | null,
  options: Electron.OpenDialogOptions,
): Promise<DesktopPathPickResult> {
  const result =
    main_window === null
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(main_window, options);
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
  default_name: string,
  filters: Electron.FileFilter[],
): Promise<DesktopPathPickResult> {
  const dialog_options: Electron.SaveDialogOptions = {
    filters,
  };
  if (default_name !== "") {
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
