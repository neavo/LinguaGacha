import type {
  DesktopCoreApiInfo,
  DesktopPathPickResult,
  DesktopRendererDiagnosticsPayload,
  DesktopShellInfo,
  ThemeMode,
} from "./bridge-types";

export const DESKTOP_BRIDGE_GLOBAL_NAME = "desktopApp"; // preload 只通过这个全局名暴露桌面能力，renderer 不直接接触 Electron 或 Node

export interface DesktopBridgeApi {
  shell: DesktopShellInfo; // 宿主壳层快照只在 preload 初始化时生成，renderer 按快照渲染标题栏安全区
  coreApi: DesktopCoreApiInfo; // Core API 地址由 main 创建窗口时注入，renderer 不读取环境变量或猜测端口
  getPathForFile: (file: File) => string; // 文件路径解析必须留在 preload，避免 renderer 获得泛化文件系统能力
  setTitleBarTheme: (theme_mode: ThemeMode) => void; // 标题栏主题同步只暴露明暗两态，main 负责转换成原生 overlay 配色
  quitApp: () => Promise<void>; // 应用退出必须回到 main 统一收尾 Core 生命周期
  openLogWindow: () => Promise<void>; // 日志窗口单例由 main 持有，renderer 只发起显隐请求
  onWindowCloseRequest: (callback: () => void) => () => void; // 主窗口关闭确认由 renderer 展示 UI，main 只发送请求事件
  reportRendererDiagnostics: (payload: DesktopRendererDiagnosticsPayload) => void; // renderer 崩溃前的轻量黑匣子面包屑留在 main，避免依赖崩溃瞬间 HTTP 上报
  openExternalUrl: (url: string) => Promise<void>; // 外链打开必须经 main 的协议白名单校验后交给系统浏览器
  pickProjectSourceFilePath: () => Promise<DesktopPathPickResult>; // 项目源文件入口允许多选，格式校验留给后续 Core / renderer 流程
  pickProjectSourceDirectoryPath: () => Promise<DesktopPathPickResult>; // 项目源目录入口只返回目录路径，和源文件入口保持语义分离
  pickProjectFilePath: () => Promise<DesktopPathPickResult>; // 打开已有工程只通过 main 原生对话框返回受控路径
  pickProjectSavePath: (default_name: string) => Promise<DesktopPathPickResult>; // 工程保存路径由 renderer 给出默认名，main 负责系统对话框确认
  pickWorkbenchFilePath: () => Promise<DesktopPathPickResult>; // 工作台追加文件入口允许多选，去重与解析不放在 preload
  pickFixedProjectDirectory: (default_path?: string) => Promise<DesktopPathPickResult>; // 固定工程目录选择可以带入当前配置路径，最终路径仍由 main 确认
  pickGlossaryImportFilePath: () => Promise<DesktopPathPickResult>; // 术语导入导出只暴露路径选择，具体格式读写由业务流程处理
  pickGlossaryExportPath: (default_name: string) => Promise<DesktopPathPickResult>; // 术语导出路径由 main 保存对话框确认，序列化格式由业务流程按后缀决定
  pickPromptImportFilePath: () => Promise<DesktopPathPickResult>; // Prompt 导入导出只暴露纯文本路径选择，不让 renderer 触碰 Node 文件 API
  pickPromptExportFilePath: () => Promise<DesktopPathPickResult>; // Prompt 导出路径由 main 保存对话框确认，renderer 不直接访问文件系统
}
