import { afterEach, describe, expect, it, vi } from "vitest";

type Listener = () => void;

const created_windows: FakeBrowserWindow[] = [];

class FakeBrowserWindow {
  options: Record<string, unknown>;
  visible = false;
  destroyed = false;
  focused = false;
  load_calls: string[] = [];
  once_listeners = new Map<string, Listener[]>();
  listeners = new Map<string, Listener[]>();

  constructor(options: Record<string, unknown>) {
    this.options = options;
    created_windows.push(this);
  }

  once(event_name: string, listener: Listener): void {
    const listeners = this.once_listeners.get(event_name) ?? [];
    listeners.push(listener);
    this.once_listeners.set(event_name, listeners);
  }

  on(event_name: string, listener: Listener): void {
    const listeners = this.listeners.get(event_name) ?? [];
    listeners.push(listener);
    this.listeners.set(event_name, listeners);
  }

  emit(event_name: string): void {
    for (const listener of this.once_listeners.get(event_name) ?? []) {
      listener();
    }
    this.once_listeners.delete(event_name);
    for (const listener of this.listeners.get(event_name) ?? []) {
      listener();
    }
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  isVisible(): boolean {
    return this.visible;
  }

  show(): void {
    this.visible = true;
  }

  focus(): void {
    this.focused = true;
  }

  close(): void {
    this.destroyed = true;
    this.emit("closed");
  }
}

vi.mock("electron", () => {
  return {
    BrowserWindow: FakeBrowserWindow,
  };
});

describe("LogWindowManager", () => {
  afterEach(() => {
    created_windows.length = 0;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("创建日志窗口并在重复打开时聚焦单例", async () => {
    const { LogWindowManager } = await import("./log-window-manager");
    const load_target = vi.fn();
    const register_window = vi.fn();
    const manager = new LogWindowManager({
      createWindowOptions: () => ({
        width: 100,
        height: 100,
      }),
      loadTarget: load_target,
      registerWindow: register_window,
    });

    manager.open();
    created_windows[0]?.emit("ready-to-show");
    manager.open();

    expect(created_windows).toHaveLength(1);
    expect(created_windows[0]?.options).toMatchObject({
      title: "Logs",
      width: 100,
      height: 100,
    });
    expect(register_window).toHaveBeenCalledTimes(1);
    expect(load_target).toHaveBeenCalledWith(created_windows[0]);
    expect(created_windows[0]?.visible).toBe(true);
    expect(created_windows[0]?.focused).toBe(true);
  });

  it("日志窗口显示时再次切换会关闭窗口", async () => {
    const { LogWindowManager } = await import("./log-window-manager");
    const manager = new LogWindowManager({
      createWindowOptions: () => ({}),
      loadTarget: vi.fn(),
      registerWindow: vi.fn(),
    });

    manager.toggle();
    created_windows[0]?.emit("ready-to-show");
    manager.toggle();

    expect(created_windows).toHaveLength(1);
    expect(created_windows[0]?.destroyed).toBe(true);
  });

  it("关闭后允许重新创建日志窗口", async () => {
    const { LogWindowManager } = await import("./log-window-manager");
    const manager = new LogWindowManager({
      createWindowOptions: () => ({}),
      loadTarget: vi.fn(),
      registerWindow: vi.fn(),
    });

    manager.open();
    manager.close();
    manager.open();

    expect(created_windows).toHaveLength(2);
  });
});
