// main、preload 与 renderer 共用这一份通道词表，避免各层以字符串重新声明协议。
export const IPC_CHANNEL_TITLE_BAR_THEME = "window:set-title-bar-theme";
export const IPC_CHANNEL_REQUEST_USER_ATTENTION = "window:request-user-attention";
export const IPC_CHANNEL_RENDERER_DIAGNOSTICS = "renderer:diagnostics";
export const IPC_CHANNEL_QUIT_APP = "window:quit-app";
export const IPC_CHANNEL_WINDOW_CLOSE_REQUEST = "window:close-request";
export const IPC_CHANNEL_OPEN_LOG_WINDOW = "window:open-log-window";
export const IPC_CHANNEL_OPEN_EXTERNAL_URL = "window:open-external-url";
export const IPC_CHANNEL_UPDATE_DOWNLOAD_RELEASE = "update:download-release";
export const IPC_CHANNEL_UPDATE_DOWNLOAD_PROGRESS = "update:download-progress";
export const IPC_CHANNEL_UPDATE_LAUNCH_BERSERKER = "update:launch-berserker";
// 所有原生路径选择共用一个判别联合请求，避免 main / preload 为每种用途复制通道。
export const IPC_CHANNEL_PICK_PATH = "dialog:pick-path";
