import { BrowserWindow, type BrowserWindowConstructorOptions } from "electron";

export const LOG_WINDOW_QUERY_KEY = "window";
export const LOG_WINDOW_QUERY_VALUE = "logs";

type LoadLogWindowTarget = (target_window: BrowserWindow) => void;

type LogWindowManagerOptions = {
  createWindowOptions: () => BrowserWindowConstructorOptions;
  loadTarget: LoadLogWindowTarget;
  registerWindow: (target_window: BrowserWindow) => void;
};

type OpenLogWindowOptions = {
  show?: boolean;
  focus?: boolean;
};

export class LogWindowManager {
  private log_window: BrowserWindow | null = null;
  private readonly create_window_options: () => BrowserWindowConstructorOptions;
  private readonly load_target: LoadLogWindowTarget;
  private readonly register_window: (target_window: BrowserWindow) => void;

  constructor(options: LogWindowManagerOptions) {
    this.create_window_options = options.createWindowOptions;
    this.load_target = options.loadTarget;
    this.register_window = options.registerWindow;
  }

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
      if (should_show) {
        this.show_existing_window({ focus: should_focus });
      }
    });
    next_window.on("closed", () => {
      if (this.log_window === next_window) {
        this.log_window = null;
      }
    });
    this.load_target(next_window);
  }

  toggle(): void {
    if (this.log_window !== null && !this.log_window.isDestroyed() && this.log_window.isVisible()) {
      this.close();
      return;
    }

    this.open({ show: true, focus: true });
  }

  close(): void {
    if (this.log_window === null || this.log_window.isDestroyed()) {
      this.log_window = null;
      return;
    }

    this.log_window.close();
    this.log_window = null;
  }

  private show_existing_window(options: { focus: boolean }): void {
    if (this.log_window === null || this.log_window.isDestroyed()) {
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
