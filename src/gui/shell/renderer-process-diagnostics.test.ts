import { afterEach, describe, expect, it, vi } from "vitest";

// electron mock 是测试级共享夹具，集中保存跨用例复用的 mock 状态。
const electron_mock = vi.hoisted(() => {
  return {
    crash_reporter_start: vi.fn(), // 记录 Crashpad 初始化参数
    crash_dump_directory: "C:/Users/test/AppData/Roaming/LinguaGacha/Crashpad", // 模拟 Electron 本地崩溃目录
    process_metrics: [
      {
        pid: 4242,
        type: "Tab",
        cpu: {
          percentCPUUsage: 12.5,
          idleWakeupsPerSecond: 1,
        },
        memory: {
          workingSetSize: 2048,
          peakWorkingSetSize: 4096,
          privateBytes: 1024,
        },
      },
    ],
  };
});

/**
 * 替换 Electron 宿主 API，避免测试接触真实 Crashpad 与进程指标。
 */
vi.mock("electron", () => {
  return {
    app: {
      getAppMetrics: () => electron_mock.process_metrics,
      getPath: (name: string) => {
        if (name !== "crashDumps") {
          throw new Error(`未预期的 app.getPath：${name}`);
        }
        return electron_mock.crash_dump_directory;
      },
    },
    crashReporter: {
      start: electron_mock.crash_reporter_start,
    },
  };
});

type Listener = (...args: unknown[]) => void; // 模拟 BrowserWindow 一次性事件回调

/**
 * 模拟 Electron WebContents 的崩溃诊断可读字段。
 */
class FakeWebContents {
  /**
   * 初始化测试用 webContents 身份、进程号和当前 URL。
   */
  public constructor(
    public readonly id: number,
    private readonly os_process_id: number,
    private url: string,
  ) {}

  /**
   * 返回 Chromium 子进程 PID，供诊断注册器匹配进程指标。
   */
  public getOSProcessId(): number {
    return this.os_process_id;
  }

  /**
   * 返回当前宿主 URL，测试会确认它只以摘要身份进入日志。
   */
  public getURL(): string {
    return this.url;
  }

  /**
   * 模拟窗口导航后 webContents URL 变化。
   */
  public setURL(url: string): void {
    this.url = url;
  }
}

/**
 * 模拟 BrowserWindow 的 webContents 与 closed 一次性事件。
 */
class FakeBrowserWindow {
  public readonly webContents: FakeWebContents; // 诊断注册器读取窗口状态的公开宿主对象
  private readonly once_listeners = new Map<string, Listener[]>(); // 保存 closed 等一次性事件

  /**
   * 初始化测试窗口和它持有的 webContents。
   */
  public constructor(web_contents_id: number, os_process_id: number, url: string) {
    this.webContents = new FakeWebContents(web_contents_id, os_process_id, url);
  }

  /**
   * 登记一次性窗口事件监听器。
   */
  public once(event_name: string, listener: Listener): void {
    const listeners = this.once_listeners.get(event_name) ?? [];
    listeners.push(listener);
    this.once_listeners.set(event_name, listeners);
  }

  /**
   * 触发并清空一次性窗口事件监听器。
   */
  public emit(event_name: string, ...args: unknown[]): void {
    for (const listener of this.once_listeners.get(event_name) ?? []) {
      listener(...args);
    }
    this.once_listeners.delete(event_name);
  }
}

describe("renderer process diagnostics", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("启动本地 Crashpad 收集且关闭上传", async () => {
    const { configure_renderer_crash_reporting } = await import("./renderer-process-diagnostics");

    configure_renderer_crash_reporting();
    configure_renderer_crash_reporting();

    expect(electron_mock.crash_reporter_start).toHaveBeenCalledTimes(1);
    expect(electron_mock.crash_reporter_start).toHaveBeenCalledWith(
      expect.objectContaining({
        productName: "LinguaGacha",
        uploadToServer: false,
        globalExtra: {
          component: "electron-renderer",
        },
      }),
    );
  });

  it("渲染进程崩溃上下文包含窗口身份、进程指标和脱敏后的 renderer 面包屑", async () => {
    const { create_renderer_process_diagnostics_registry } =
      await import("./renderer-process-diagnostics");
    const registry = create_renderer_process_diagnostics_registry();
    const renderer_url = "app://linguagacha/workbench"; // renderer_url 带路径段，用来验证 URL 摘要不泄露完整 href
    const target_window = new FakeBrowserWindow(7, 4242, renderer_url);

    registry.registerWindow(target_window as never, "main");
    registry.recordRendererDiagnostics(target_window.webContents as never, {
      route: "workbench",
      project: {
        loaded: true,
        path: "E:/secret/project/demo.lg",
      },
      task: {
        status: "running",
        progress: {
          line: 1888,
        },
      },
    });
    registry.recordRendererDiagnostics(target_window.webContents as never, {
      event: {
        topic: "project.data_changed",
        projectPath: "E:/secret/project/demo.lg",
        oversized: "x".repeat(5000),
      },
    });

    const context = registry.buildRendererProcessGoneContext(
      target_window as never,
      {
        reason: "crashed",
        exitCode: -36861,
      } as Electron.RenderProcessGoneDetails,
    );

    expect(context).toMatchObject({
      reason: "crashed",
      exitCode: -36861,
      windowKind: "main",
      webContentsId: 7,
      lastUrlIdentity: {
        scheme: "app",
        hostHash: expect.any(String),
        pathBasename: "workbench",
        hrefHash: expect.any(String),
        length: renderer_url.length,
      },
      osProcessId: 4242,
      crashDumpDirectory: {
        basename: "Crashpad",
        pathHash: expect.any(String),
        length: electron_mock.crash_dump_directory.length,
      },
      processMetric: {
        pid: 4242,
        type: "Tab",
        memory: {
          workingSetSize: 2048,
        },
      },
      rendererDiagnostics: {
        route: "workbench",
        project: {
          loaded: true,
          path: {
            basename: "demo.lg",
            pathHash: expect.any(String),
            length: 25,
          },
        },
      },
      recentRendererEvents: [
        {
          event: {
            topic: "project.data_changed",
            projectPath: {
              basename: "demo.lg",
              pathHash: expect.any(String),
              length: 25,
            },
          },
        },
      ],
    });
    const recent_events = context["recentRendererEvents"];
    if (!Array.isArray(recent_events)) {
      throw new Error("缺少 renderer 事件面包屑。");
    }
    const first_event = recent_events[0] as { event: Record<string, unknown> };
    expect(first_event.event).not.toHaveProperty("oversized");
    expect(context).not.toHaveProperty("lastUrl");
  });
});
