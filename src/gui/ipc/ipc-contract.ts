import type {
  DesktopPathPickResult,
  DesktopRendererDiagnosticsPayload,
  ThemeMode,
} from "../bridge/bridge-types";

// IPC CHANNEL TITLE BAR THEME 是 main/preload/renderer 共享 IPC 通道名，必须集中维护避免拼写漂移。
export const IPC_CHANNEL_TITLE_BAR_THEME = "window:set-title-bar-theme";
// IPC CHANNEL RENDERER DIAGNOSTICS 是 main/preload/renderer 共享 IPC 通道名，必须集中维护避免拼写漂移。
export const IPC_CHANNEL_RENDERER_DIAGNOSTICS = "renderer:diagnostics";
// IPC CHANNEL QUIT APP 是 main/preload/renderer 共享 IPC 通道名，必须集中维护避免拼写漂移。
export const IPC_CHANNEL_QUIT_APP = "window:quit-app";
// IPC CHANNEL WINDOW CLOSE REQUEST 是 main/preload/renderer 共享 IPC 通道名，必须集中维护避免拼写漂移。
export const IPC_CHANNEL_WINDOW_CLOSE_REQUEST = "window:close-request";
// IPC CHANNEL OPEN LOG WINDOW 是 main/preload/renderer 共享 IPC 通道名，必须集中维护避免拼写漂移。
export const IPC_CHANNEL_OPEN_LOG_WINDOW = "window:open-log-window";
// IPC CHANNEL OPEN EXTERNAL URL 是 main/preload/renderer 共享 IPC 通道名，必须集中维护避免拼写漂移。
export const IPC_CHANNEL_OPEN_EXTERNAL_URL = "window:open-external-url";
// IPC CHANNEL PICK PROJECT SOURCE FILE PATH 是 main/preload/renderer 共享 IPC 通道名，必须集中维护避免拼写漂移。
export const IPC_CHANNEL_PICK_PROJECT_SOURCE_FILE_PATH = "dialog:pick-project-source-file-path";
// IPC CHANNEL PICK PROJECT SOURCE DIRECTORY PATH 是 main/preload/renderer 共享 IPC 通道名，必须集中维护避免拼写漂移。
export const IPC_CHANNEL_PICK_PROJECT_SOURCE_DIRECTORY_PATH =
  "dialog:pick-project-source-directory-path";
// IPC CHANNEL PICK PROJECT FILE PATH 是 main/preload/renderer 共享 IPC 通道名，必须集中维护避免拼写漂移。
export const IPC_CHANNEL_PICK_PROJECT_FILE_PATH = "dialog:pick-project-file-path";
// IPC CHANNEL PICK PROJECT SAVE PATH 是 main/preload/renderer 共享 IPC 通道名，必须集中维护避免拼写漂移。
export const IPC_CHANNEL_PICK_PROJECT_SAVE_PATH = "dialog:pick-project-save-path";
// IPC CHANNEL PICK WORKBENCH FILE PATH 是 main/preload/renderer 共享 IPC 通道名，必须集中维护避免拼写漂移。
export const IPC_CHANNEL_PICK_WORKBENCH_FILE_PATH = "dialog:pick-workbench-file-path";
// IPC CHANNEL PICK FIXED PROJECT DIRECTORY 是 main/preload/renderer 共享 IPC 通道名，必须集中维护避免拼写漂移。
export const IPC_CHANNEL_PICK_FIXED_PROJECT_DIRECTORY = "dialog:pick-fixed-project-directory";
// IPC CHANNEL PICK GLOSSARY IMPORT FILE PATH 是 main/preload/renderer 共享 IPC 通道名，必须集中维护避免拼写漂移。
export const IPC_CHANNEL_PICK_GLOSSARY_IMPORT_FILE_PATH = "dialog:pick-glossary-import-file-path";
// IPC CHANNEL PICK GLOSSARY EXPORT PATH 是 main/preload/renderer 共享 IPC 通道名，必须集中维护避免拼写漂移。
export const IPC_CHANNEL_PICK_GLOSSARY_EXPORT_PATH = "dialog:pick-glossary-export-path";
// IPC CHANNEL PICK PROMPT IMPORT FILE PATH 是 main/preload/renderer 共享 IPC 通道名，必须集中维护避免拼写漂移。
export const IPC_CHANNEL_PICK_PROMPT_IMPORT_FILE_PATH = "dialog:pick-prompt-import-file-path";
// IPC CHANNEL PICK PROMPT EXPORT FILE PATH 是 main/preload/renderer 共享 IPC 通道名，必须集中维护避免拼写漂移。
export const IPC_CHANNEL_PICK_PROMPT_EXPORT_FILE_PATH = "dialog:pick-prompt-export-file-path";

// invoke 型 IPC 的参数和返回值集中在契约层，避免 main / preload 各写一份隐式形状
export type DesktopIpcInvokeContract = {
  [IPC_CHANNEL_QUIT_APP]: {
    args: [];
    result: void;
  };
  [IPC_CHANNEL_OPEN_LOG_WINDOW]: {
    args: [];
    result: void;
  };
  [IPC_CHANNEL_OPEN_EXTERNAL_URL]: {
    args: [url: string];
    result: void;
  };
  [IPC_CHANNEL_PICK_PROJECT_SOURCE_FILE_PATH]: {
    args: [];
    result: DesktopPathPickResult;
  };
  [IPC_CHANNEL_PICK_PROJECT_SOURCE_DIRECTORY_PATH]: {
    args: [];
    result: DesktopPathPickResult;
  };
  [IPC_CHANNEL_PICK_PROJECT_FILE_PATH]: {
    args: [];
    result: DesktopPathPickResult;
  };
  [IPC_CHANNEL_PICK_PROJECT_SAVE_PATH]: {
    args: [default_name: string];
    result: DesktopPathPickResult;
  };
  [IPC_CHANNEL_PICK_WORKBENCH_FILE_PATH]: {
    args: [];
    result: DesktopPathPickResult;
  };
  [IPC_CHANNEL_PICK_FIXED_PROJECT_DIRECTORY]: {
    args: [default_path?: string];
    result: DesktopPathPickResult;
  };
  [IPC_CHANNEL_PICK_GLOSSARY_IMPORT_FILE_PATH]: {
    args: [];
    result: DesktopPathPickResult;
  };
  [IPC_CHANNEL_PICK_GLOSSARY_EXPORT_PATH]: {
    args: [default_name: string];
    result: DesktopPathPickResult;
  };
  [IPC_CHANNEL_PICK_PROMPT_IMPORT_FILE_PATH]: {
    args: [];
    result: DesktopPathPickResult;
  };
  [IPC_CHANNEL_PICK_PROMPT_EXPORT_FILE_PATH]: {
    args: [];
    result: DesktopPathPickResult;
  };
};

// send 型 IPC 只用于无返回值通知，当前由 renderer 主题同步、诊断面包屑和 main 关闭请求组成
export type DesktopIpcSendContract = {
  [IPC_CHANNEL_TITLE_BAR_THEME]: {
    args: [theme_mode: ThemeMode];
  };
  [IPC_CHANNEL_RENDERER_DIAGNOSTICS]: {
    args: [payload: DesktopRendererDiagnosticsPayload];
  };
  [IPC_CHANNEL_WINDOW_CLOSE_REQUEST]: {
    args: [];
  };
};
