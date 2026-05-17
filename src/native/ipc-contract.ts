import type { DesktopPathPickResult, ThemeMode } from "./bridge-types";

export const IPC_CHANNEL_TITLE_BAR_THEME = "window:set-title-bar-theme";
export const IPC_CHANNEL_QUIT_APP = "window:quit-app";
export const IPC_CHANNEL_WINDOW_CLOSE_REQUEST = "window:close-request";
export const IPC_CHANNEL_OPEN_LOG_WINDOW = "window:open-log-window";
export const IPC_CHANNEL_OPEN_EXTERNAL_URL = "window:open-external-url";
export const IPC_CHANNEL_PICK_PROJECT_SOURCE_FILE_PATH = "dialog:pick-project-source-file-path";
export const IPC_CHANNEL_PICK_PROJECT_SOURCE_DIRECTORY_PATH =
  "dialog:pick-project-source-directory-path";
export const IPC_CHANNEL_PICK_PROJECT_FILE_PATH = "dialog:pick-project-file-path";
export const IPC_CHANNEL_PICK_PROJECT_SAVE_PATH = "dialog:pick-project-save-path";
export const IPC_CHANNEL_PICK_WORKBENCH_FILE_PATH = "dialog:pick-workbench-file-path";
export const IPC_CHANNEL_PICK_FIXED_PROJECT_DIRECTORY = "dialog:pick-fixed-project-directory";
export const IPC_CHANNEL_PICK_GLOSSARY_IMPORT_FILE_PATH = "dialog:pick-glossary-import-file-path";
export const IPC_CHANNEL_PICK_GLOSSARY_EXPORT_PATH = "dialog:pick-glossary-export-path";
export const IPC_CHANNEL_PICK_PROMPT_IMPORT_FILE_PATH = "dialog:pick-prompt-import-file-path";
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

// send 型 IPC 只用于无返回值通知，当前由 renderer 主题同步和 main 关闭请求组成
export type DesktopIpcSendContract = {
  [IPC_CHANNEL_TITLE_BAR_THEME]: {
    args: [theme_mode: ThemeMode];
  };
  [IPC_CHANNEL_WINDOW_CLOSE_REQUEST]: {
    args: [];
  };
};
