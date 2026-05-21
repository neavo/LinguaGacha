// 桌面主题只暴露网页壳层和原生标题栏都能稳定消费的明暗两态
export type ThemeMode = "light" | "dark";

// 标题栏控制按钮方位来自宿主平台，renderer 只按这个结果预留安全区
export type TitleBarControlSide = "left" | "right" | "none";

// Electron 支持的平台字符串在桌面契约层显式收口，避免 renderer 依赖 NodeJS 命名空间
export type DesktopPlatform =
  | "aix"
  | "android"
  | "darwin"
  | "freebsd"
  | "haiku"
  | "linux"
  | "openbsd"
  | "sunos"
  | "win32"
  | "cygwin"
  | "netbsd";

export type DesktopCoreApiInfo = {
  baseUrl: string; // main 启动公开 API Gateway 后注入给 preload 的本机访问地址
  systemProxyStartupNotice: DesktopSystemProxyStartupNotice; // 启动期系统代理提示摘要，不包含完整代理 URI
};

export type DesktopSystemProxyStartupNotice = {
  detected: boolean; // renderer 只关心是否需要提示用户，不重新判断系统代理
  proxiedOriginCount: number; // 命中的远端 origin 数量，用于测试和诊断摘要
  proxyDisplay: string | null; // 去除凭据和路径后的代理 URL 展示值，用于填充启动提示
};

export type DesktopShellInfo = {
  platform: DesktopPlatform; // 当前宿主平台快照
  usesTitleBarOverlay: boolean; // 是否由原生 overlay 提供窗口控制按钮
  titleBarHeight: number; // renderer 标题栏高度，需和 main overlay 高度契约一致
  titleBarControlSide: TitleBarControlSide; // 原生控制按钮所在逻辑侧
  titleBarSafeAreaStart: number; // 标题栏起始侧预留宽度
  titleBarSafeAreaEnd: number; // 标题栏结束侧预留宽度
};

export type DesktopPathPickResult = {
  canceled: boolean; // 用户取消或没有可用路径时为 true
  paths: string[]; // 经 main 原生对话框确认后返回给 renderer 的路径快照
};
