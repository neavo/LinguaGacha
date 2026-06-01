import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "@frontend/app/index";
import { create_desktop_bridge_api_mock } from "../../test/desktop-bridge-mock";

type AlertDialogRenderProps = {
  open: boolean;
  description: string;
  submitting?: boolean;
  confirmLabel?: string;
  submittingLabel?: string;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
};
type GithubReleaseUpdateMock = {
  latest_version: string;
  release_url: string;
  windows_x64_zip_url: string | null;
};

// toast mock 是测试级共享夹具，集中保存跨用例复用的 mock 状态。
const toast_mock = vi.hoisted(() => {
  // toast_mock 让 App 根测试可以观察 toast 类型和文案，而不渲染真实 sonner UI
  return {
    push_persistent_toast: vi.fn(),
    push_toast: vi.fn(),
  };
});

const desktop_api_mock = vi.hoisted(() => {
  return {
    api_fetch: vi.fn(async () => ({ settings: { app_language: "ZH" } })),
    check_github_release_update: vi.fn<
      (_current_version: string) => Promise<GithubReleaseUpdateMock | null>
    >(async () => null),
    get_backend_metadata: vi.fn(async () => ({ version: "9.8.7" })),
    open_external_url: vi.fn(async () => undefined),
    report_renderer_error: vi.fn(async () => undefined),
  };
});

const alert_dialog_mock = vi.hoisted(() => {
  return {
    render_props: [] as AlertDialogRenderProps[],
  };
});

// state provider mock 是测试级共享夹具，集中保存跨用例复用的 mock 状态。
const runtime_provider_mock = vi.hoisted(() => {
  return {
    render_desktop_runtime_provider: vi.fn(),
  };
});

// 让主窗口根测试能确认 session UI 状态 Provider 已接入。
const project_session_ui_state_provider_mock = vi.hoisted(() => {
  return {
    render_project_session_ui_state_provider: vi.fn(),
  };
});

vi.mock("next-themes", () => {
  return {
    ThemeProvider: (props: { children: ReactNode }) => <>{props.children}</>,
    useTheme: () => ({
      resolvedTheme: "light",
      setTheme: vi.fn(),
    }),
  };
});

vi.mock("@frontend/app/navigation/schema", () => {
  return {
    DEFAULT_ROUTE_ID: "project-home",
    BOTTOM_ACTIONS: [],
    NAVIGATION_GROUPS: [],
  };
});

vi.mock("@frontend/app/navigation/screen-registry", () => {
  return {
    SCREEN_REGISTRY: {
      "project-home": {
        title_key: "app.metadata.app_name",
        component: () => null,
      },
    },
  };
});

vi.mock("@frontend/app/navigation/navigation-context", () => {
  return {
    AppNavigationProvider: (props: { children: ReactNode }) => <>{props.children}</>,
  };
});

vi.mock("@frontend/app/state/desktop-state-context", () => {
  return {
    DesktopStateProvider: (props: { children: ReactNode }) => {
      runtime_provider_mock.render_desktop_runtime_provider();
      return <>{props.children}</>;
    },
  };
});

vi.mock("@frontend/app/session/project-session-context", () => {
  return {
    ProjectSessionProvider: (props: { children: ReactNode }) => <>{props.children}</>,
  };
});

vi.mock("@frontend/app/session/project-session-ui-state-context", () => {
  return {
    ProjectSessionUiStateProvider: (props: { children: ReactNode }) => {
      project_session_ui_state_provider_mock.render_project_session_ui_state_provider();
      return <>{props.children}</>;
    },
  };
});

vi.mock("@frontend/app/session/workbench-tasks/workbench-tasks-session-context", () => {
  return {
    WorkbenchTasksSessionProvider: (props: { children: ReactNode }) => <>{props.children}</>,
  };
});

vi.mock("@frontend/app/session/quality-rule-statistics-context", () => {
  return {
    QualityRuleStatisticsProvider: (props: { children: ReactNode }) => <>{props.children}</>,
  };
});

vi.mock("@frontend/app/state/use-desktop-state", () => {
  return {
    useDesktopState: () => ({
      initial_state_ready: true,
      pending_target_route: null,
      is_app_language_updating: false,
      project_snapshot: { loaded: false, path: "" },
      project_session_status: "idle",
      settings_snapshot: { app_language: "ZH" },
      task_snapshot: {
        run_revision: 0,
        task_type: "translation",
        status: "idle",
        busy: false,
        request_in_flight_count: 0,
        progress: {
          line: 0,
          total_line: 0,
          processed_line: 0,
          error_line: 0,
        },
      },
      set_pending_target_route: vi.fn(),
      update_app_language: vi.fn(),
    }),
  };
});

vi.mock("@frontend/app/desktop/desktop-api", () => {
  return desktop_api_mock;
});

vi.mock("@frontend/app/feedback/desktop-toast", () => {
  return {
    DesktopProgressToastModalLayer: () => null,
    useDesktopToast: () => ({
      push_persistent_toast: toast_mock.push_persistent_toast,
      push_toast: toast_mock.push_toast,
    }),
  };
});

vi.mock("@frontend/app/locale/locale-provider", () => {
  return {
    LocaleProvider: (props: { app_language: unknown; children: ReactNode }) => (
      <>{props.children}</>
    ),
    useI18n: () => ({
      t: (key: string, params?: Record<string, string>) =>
        key === "app.system_proxy.startup_notice" ? `${key}:${params?.["PROXY"] ?? ""}` : key,
    }),
  };
});

vi.mock("@frontend/shadcn/sidebar", () => {
  return {
    SidebarInset: (props: { children: ReactNode }) => <>{props.children}</>,
    SidebarProvider: (props: { children: ReactNode }) => <>{props.children}</>,
  };
});

vi.mock("@frontend/shadcn/sonner", () => {
  return {
    Toaster: () => null,
  };
});

vi.mock("@frontend/shadcn/tooltip", () => {
  return {
    TooltipProvider: (props: { children: ReactNode }) => <>{props.children}</>,
  };
});

vi.mock("@frontend/app/shell/app-sidebar", () => {
  return {
    AppSidebar: () => null,
  };
});

vi.mock("@frontend/app/shell/app-titlebar", () => {
  return {
    AppTitlebar: () => null,
  };
});

vi.mock("@frontend/widgets/app-alert-dialog", () => {
  return {
    AppAlertDialog: (props: AlertDialogRenderProps) => {
      alert_dialog_mock.render_props.push(props);
      return null;
    },
  };
});

vi.mock("@frontend/pages/log-window-page/page", () => {
  return {
    LogWindowPage: () => <div data-testid="log-window-page" />,
  };
});

/**
 * 配置当前测试场景依赖。
 */
function install_local_storage_fallback(): void {
  if (typeof window.localStorage.setItem === "function") {
    return;
  }

  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      clear: () => {
        values.clear();
      },
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => {
        values.delete(key);
      },
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    },
  });
}

describe("App 字体模式同步", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    install_local_storage_fallback();
    desktop_api_mock.api_fetch.mockResolvedValue({ settings: { app_language: "ZH" } });
    desktop_api_mock.check_github_release_update.mockResolvedValue(null);
    desktop_api_mock.get_backend_metadata.mockResolvedValue({ version: "9.8.7" });
    desktop_api_mock.open_external_url.mockResolvedValue(undefined);
    desktop_api_mock.report_renderer_error.mockResolvedValue(undefined);
    Object.defineProperty(window, "desktopApp", {
      configurable: true,
      value: create_desktop_bridge_api_mock(),
    });
  });

  afterEach(async () => {
    if (root !== null) {
      await act(async () => {
        root?.unmount();
      });
    }

    container?.remove();
    container = null;
    root = null;
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-lg-base-font");
    window.history.replaceState(null, "", "/");
    vi.clearAllMocks();
    alert_dialog_mock.render_props = [];
  });

  // 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
  /**
   * 挂载当前测试组件并等待渲染完成。
   */
  async function mount_app_at(url: string): Promise<void> {
    window.history.replaceState(null, "", url);
    window.localStorage.setItem("lg-theme-mode", "light");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<App />);
    });
  }

  /**
   * 刷新 App 根组件内连续触发的异步 effect。
   */
  async function flush_app_effects(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  /**
   * 读取最新打开的确认框 props，帮助测试直接触发公开回调。
   */
  function read_latest_open_dialog(): AlertDialogRenderProps {
    const dialog = alert_dialog_mock.render_props.filter((props) => props.open).at(-1);
    if (dialog === undefined) {
      throw new Error("缺少打开中的确认框。");
    }
    return dialog;
  }

  it("日志窗口启动时会继承已保存的字体模式", async () => {
    window.localStorage.setItem("lg-base-font-mode", "disabled");

    await mount_app_at("/?window=logs");

    expect(container?.querySelector('[data-testid="log-window-page"]')).not.toBeNull();
    expect(document.documentElement.dataset.lgBaseFont).toBe("disabled");
    expect(runtime_provider_mock.render_desktop_runtime_provider).not.toHaveBeenCalled();
  });

  it("日志窗口会响应其他窗口写入的字体模式变化", async () => {
    window.localStorage.setItem("lg-base-font-mode", "disabled");

    await mount_app_at("/?window=logs");

    await act(async () => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "lg-base-font-mode",
          oldValue: "disabled",
          newValue: "enabled",
        }),
      );
    });

    expect(document.documentElement.dataset.lgBaseFont).toBe("enabled");
    expect(window.localStorage.getItem("lg-base-font-mode")).toBe("enabled");
  });

  it("主窗口加载完成后展示一次系统代理启动提示", async () => {
    Object.defineProperty(window, "desktopApp", {
      configurable: true,
      value: create_desktop_bridge_api_mock({
        backendApi: {
          systemProxyStartupNotice: {
            detected: true,
            proxiedOriginCount: 2,
            proxyDisplay: "http://127.0.0.1:7890",
          },
        },
      }),
    });

    await mount_app_at("/");
    await act(async () => {
      await Promise.resolve();
    });

    expect(toast_mock.push_toast).toHaveBeenCalledTimes(1);
    expect(toast_mock.push_toast).toHaveBeenCalledWith(
      "info",
      "app.system_proxy.startup_notice:http://127.0.0.1:7890",
    );

    await act(async () => {
      root?.render(<App />);
    });

    expect(toast_mock.push_toast).toHaveBeenCalledTimes(1);
  });

  it("检查到新版本后通过确认框下载并进入重启更新状态", async () => {
    desktop_api_mock.check_github_release_update.mockResolvedValueOnce({
      latest_version: "1.2.4",
      release_url: "https://github.com/neavo/LinguaGacha/releases/tag/v1.2.4",
      windows_x64_zip_url:
        "https://github.com/neavo/LinguaGacha/releases/download/v1.2.4/LinguaGacha_v1.2.4_Windows_x64.zip",
    });
    const download_update = vi.fn(async (_request, on_progress) => {
      on_progress({
        request_id: "download-1",
        progress_percent: 45.678,
        downloaded_bytes: 456,
        total_bytes: 1000,
      });
      return {
        status: "downloaded" as const,
        latest_version: "1.2.4",
        release_url: "https://github.com/neavo/LinguaGacha/releases/tag/v1.2.4",
        zip_path: "E:/LinguaGacha/userdata/berserker/v1.2.4/update.zip",
      };
    });
    Object.defineProperty(window, "desktopApp", {
      configurable: true,
      value: create_desktop_bridge_api_mock({
        methods: {
          downloadUpdate: download_update,
        },
      }),
    });

    await mount_app_at("/");
    await flush_app_effects();
    const confirm_dialog = read_latest_open_dialog();

    expect(confirm_dialog.description).toBe("app.update.confirm_description");
    expect(confirm_dialog.confirmLabel).toBe("app.action.confirm");
    expect(toast_mock.push_persistent_toast).not.toHaveBeenCalled();

    await act(async () => {
      await confirm_dialog.onConfirm();
    });
    const ready_dialog = read_latest_open_dialog();

    expect(download_update).toHaveBeenCalledWith(
      {
        latest_version: "1.2.4",
        release_url: "https://github.com/neavo/LinguaGacha/releases/tag/v1.2.4",
        windows_x64_zip_url:
          "https://github.com/neavo/LinguaGacha/releases/download/v1.2.4/LinguaGacha_v1.2.4_Windows_x64.zip",
      },
      expect.any(Function),
    );
    expect(ready_dialog.confirmLabel).toBe("app.update.restart_confirm");
    expect(ready_dialog.submitting).toBe(false);
  });

  it("自动更新条件不满足时打开发布页回退", async () => {
    desktop_api_mock.check_github_release_update.mockResolvedValueOnce({
      latest_version: "1.2.4",
      release_url: "https://github.com/neavo/LinguaGacha/releases/tag/v1.2.4",
      windows_x64_zip_url: null,
    });
    Object.defineProperty(window, "desktopApp", {
      configurable: true,
      value: create_desktop_bridge_api_mock({
        methods: {
          downloadUpdate: async () => ({
            status: "fallback_to_release_page",
            release_url: "https://github.com/neavo/LinguaGacha/releases/tag/v1.2.4",
            reason: "missing_windows_x64_zip_url",
          }),
        },
      }),
    });

    await mount_app_at("/");
    await flush_app_effects();

    await act(async () => {
      await read_latest_open_dialog().onConfirm();
    });

    expect(desktop_api_mock.open_external_url).toHaveBeenCalledWith(
      "https://github.com/neavo/LinguaGacha/releases/tag/v1.2.4",
    );
  });

  it("下载完成后点击重启并更新会启动更新器并保持处理中状态", async () => {
    desktop_api_mock.check_github_release_update.mockResolvedValueOnce({
      latest_version: "1.2.4",
      release_url: "https://github.com/neavo/LinguaGacha/releases/tag/v1.2.4",
      windows_x64_zip_url:
        "https://github.com/neavo/LinguaGacha/releases/download/v1.2.4/LinguaGacha_v1.2.4_Windows_x64.zip",
    });
    const launch_update = vi.fn(async () => ({ status: "launched" as const }));
    Object.defineProperty(window, "desktopApp", {
      configurable: true,
      value: create_desktop_bridge_api_mock({
        methods: {
          downloadUpdate: async () => ({
            status: "downloaded",
            latest_version: "1.2.4",
            release_url: "https://github.com/neavo/LinguaGacha/releases/tag/v1.2.4",
            zip_path: "E:/LinguaGacha/userdata/berserker/v1.2.4/update.zip",
          }),
          launchUpdate: launch_update,
        },
      }),
    });

    await mount_app_at("/");
    await flush_app_effects();
    await act(async () => {
      await read_latest_open_dialog().onConfirm();
    });
    await act(async () => {
      await read_latest_open_dialog().onConfirm();
    });
    const launching_dialog = read_latest_open_dialog();

    expect(launch_update).toHaveBeenCalledWith({
      latest_version: "1.2.4",
      zip_path: "E:/LinguaGacha/userdata/berserker/v1.2.4/update.zip",
    });
    expect(launching_dialog.submitting).toBe(true);
    expect(launching_dialog.submittingLabel).toBe("app.update.launching");
  });

  it("主窗口项目 session 内挂载项目 UI 状态 Provider", async () => {
    await mount_app_at("/");

    expect(runtime_provider_mock.render_desktop_runtime_provider).toHaveBeenCalledTimes(1);
    expect(
      project_session_ui_state_provider_mock.render_project_session_ui_state_provider,
    ).toHaveBeenCalled();
  });
});
