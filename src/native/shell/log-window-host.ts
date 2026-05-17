import { BrowserWindow, type BrowserWindowConstructorOptions } from "electron";

export const LOG_WINDOW_QUERY_KEY = "window";
export const LOG_WINDOW_QUERY_VALUE = "logs";

// 日志窗口复用同一份 renderer bundle，通过查询参数切到独立日志页面
type LoadLogWindowTarget = (target_window: BrowserWindow) => void;

type LogWindowHostOptions = {
  createWindowOptions: () => BrowserWindowConstructorOptions; // 窗口能力仍由主窗口入口统一提供，避免日志窗口绕开壳层策略
  loadTarget: LoadLogWindowTarget;
  registerWindow: (target_window: BrowserWindow) => void; // 宿主侧运行时事件由窗口 shell 接入，避免本类反向知道 DevTools 和关闭确认细节
};

type OpenLogWindowOptions = {
  show?: boolean;
  focus?: boolean;
};

/**
 * Electron main 侧的日志窗口宿主，只负责 BrowserWindow 生命周期
 *
 * 日志数据、筛选与展示都归 renderer 日志页面；这里保持单例窗口，是为了让侧栏日志入口
 * 表达“打开 / 聚焦 / 关闭同一个诊断视图”，而不是不断生成互相竞争的日志订阅者
 */
export class LogWindowHost {
  private log_window: BrowserWindow | null = null;
  private readonly create_window_options: () => BrowserWindowConstructorOptions;
  private readonly load_target: LoadLogWindowTarget;
  private readonly register_window: (target_window: BrowserWindow) => void;

  /**
   * 注入窗口创建、运行期事件注册和 renderer 加载策略，避免日志窗口自建壳层规则。
   */
  constructor(options: LogWindowHostOptions) {
    this.create_window_options = options.createWindowOptions;
    this.load_target = options.loadTarget;
    this.register_window = options.registerWindow;
  }

  /**
   * 打开或复用日志窗口，保持日志诊断视图在 main 侧只有一个原生实例。
   */
  open(options: OpenLogWindowOptions = {}): void {
    const should_show = options.show ?? true;
    const should_focus = options.focus ?? should_show;

    if (this.log_window !== null && !this.log_window.isDestroyed()) {
      if (should_show) {
        this.show_existing_window({ focus: should_focus });
      }
      return;
    }

    const next_window = new BrowserWindow({
      ...this.create_window_options(),
      title: "Logs",
    });
    this.log_window = next_window;
    this.register_window(next_window);
    next_window.once("ready-to-show", () => {
      // 只在 renderer 首帧就绪后显示，避免日志窗口短暂露出空白壳层
      if (should_show) {
        this.show_existing_window({ focus: should_focus });
      }
    });
    next_window.on("closed", () => {
      // close() 和用户直接关窗都会到这里，只清理当前实例，避免旧事件误伤新窗口
      if (this.log_window === next_window) {
        this.log_window = null;
      }
    });
    this.load_target(next_window);
  }

  /**
   * 按侧栏入口语义切换日志窗口显隐，显示态再次触发即关闭当前实例。
   */
  toggle(): void {
    // 侧栏日志入口承担显隐开关语义：已显示则关闭，隐藏或未创建则拉到前台
    if (this.log_window !== null && !this.log_window.isDestroyed() && this.log_window.isVisible()) {
      this.close();
      return;
    }

    this.open({ show: true, focus: true });
  }

  /**
   * 主动关闭日志窗口，并同步清理 main 侧持有的窗口引用。
   */
  close(): void {
    if (this.log_window === null || this.log_window.isDestroyed()) {
      // Electron 可能已先销毁原生窗口，本地引用必须同步归零，避免后续误判为可复用
      this.log_window = null;
      return;
    }

    this.log_window.close();
    this.log_window = null;
  }

  /**
   * 显示并聚焦仍然有效的日志窗口，失效引用会在这里被清空。
   */
  private show_existing_window(options: { focus: boolean }): void {
    if (this.log_window === null || this.log_window.isDestroyed()) {
      // 显示入口也做防御式清理，让异步 ready-to-show 回调不复活失效引用
      this.log_window = null;
      return;
    }

    if (!this.log_window.isVisible()) {
      this.log_window.show();
    }
    if (options.focus) {
      this.log_window.focus();
    }
  }
}
