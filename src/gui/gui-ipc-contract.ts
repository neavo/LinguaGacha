import type {
  DesktopPathPickIpcRequest,
  DesktopPathPickResult,
  DesktopRendererDiagnosticsPayload,
  DesktopUpdateDownloadIpcRequest,
  DesktopUpdateDownloadProgress,
  DesktopUpdateDownloadResult,
  DesktopUpdateLaunchRequest,
  DesktopUpdateLaunchResult,
  ThemeMode,
} from "./bridge/bridge-types";

// IPC CHANNEL TITLE BAR THEME 是 main/preload/renderer 共享 IPC 通道名，必须集中维护避免拼写漂移。
/**
 * 集中维护当前模块的稳定常量。
 */
export const IPC_CHANNEL_TITLE_BAR_THEME = "window:set-title-bar-theme";
// IPC CHANNEL RENDERER DIAGNOSTICS 是 main/preload/renderer 共享 IPC 通道名，必须集中维护避免拼写漂移。
/**
 * 集中维护当前模块的稳定常量。
 */
export const IPC_CHANNEL_RENDERER_DIAGNOSTICS = "renderer:diagnostics";
// IPC CHANNEL QUIT APP 是 main/preload/renderer 共享 IPC 通道名，必须集中维护避免拼写漂移。
/**
 * 集中维护当前模块的稳定常量。
 */
export const IPC_CHANNEL_QUIT_APP = "window:quit-app";
// IPC CHANNEL WINDOW CLOSE REQUEST 是 main/preload/renderer 共享 IPC 通道名，必须集中维护避免拼写漂移。
/**
 * 集中维护当前模块的稳定常量。
 */
export const IPC_CHANNEL_WINDOW_CLOSE_REQUEST = "window:close-request";
// IPC CHANNEL OPEN LOG WINDOW 是 main/preload/renderer 共享 IPC 通道名，必须集中维护避免拼写漂移。
/**
 * 集中维护当前模块的稳定常量。
 */
export const IPC_CHANNEL_OPEN_LOG_WINDOW = "window:open-log-window";
// IPC CHANNEL OPEN EXTERNAL URL 是 main/preload/renderer 共享 IPC 通道名，必须集中维护避免拼写漂移。
/**
 * 集中维护当前模块的稳定常量。
 */
export const IPC_CHANNEL_OPEN_EXTERNAL_URL = "window:open-external-url";
// IPC CHANNEL UPDATE DOWNLOAD RELEASE 是 main/preload/renderer 共享 IPC 通道名，必须集中维护避免拼写漂移。
/**
 * 集中维护当前模块的稳定常量。
 */
export const IPC_CHANNEL_UPDATE_DOWNLOAD_RELEASE = "update:download-release";
// IPC CHANNEL UPDATE DOWNLOAD PROGRESS 是 main/preload/renderer 共享 IPC 通道名，必须集中维护避免拼写漂移。
/**
 * 集中维护当前模块的稳定常量。
 */
export const IPC_CHANNEL_UPDATE_DOWNLOAD_PROGRESS = "update:download-progress";
// IPC CHANNEL UPDATE LAUNCH BERSERKER 是 main/preload/renderer 共享 IPC 通道名，必须集中维护避免拼写漂移。
/**
 * 集中维护当前模块的稳定常量。
 */
export const IPC_CHANNEL_UPDATE_LAUNCH_BERSERKER = "update:launch-berserker";
// 所有原生路径选择共用一个判别联合请求，避免 main / preload 为每种用途复制通道。
/**
 * 集中维护当前模块的稳定常量。
 */
export const IPC_CHANNEL_PICK_PATH = "dialog:pick-path";

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
  [IPC_CHANNEL_UPDATE_DOWNLOAD_RELEASE]: {
    args: [request: DesktopUpdateDownloadIpcRequest];
    result: DesktopUpdateDownloadResult;
  };
  [IPC_CHANNEL_UPDATE_LAUNCH_BERSERKER]: {
    args: [request: DesktopUpdateLaunchRequest];
    result: DesktopUpdateLaunchResult;
  };
  [IPC_CHANNEL_PICK_PATH]: {
    args: [request: DesktopPathPickIpcRequest];
    result: DesktopPathPickResult;
  };
};

// send 型 IPC 只用于无返回值通知，当前由 renderer 主题同步、诊断面包屑、main 关闭请求和更新进度组成
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
  [IPC_CHANNEL_UPDATE_DOWNLOAD_PROGRESS]: {
    args: [progress: DesktopUpdateDownloadProgress];
  };
};
