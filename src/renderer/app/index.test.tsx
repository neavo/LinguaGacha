import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "@/app/index";
import { create_desktop_bridge_api_mock } from "../../test/desktop-bridge-mock";

// toast mock 是测试级共享夹具，集中保存跨用例复用的 mock 状态。
const toast_mock = vi.hoisted(() => {
  // toast_mock 让 App 根测试可以观察 toast 类型和文案，而不渲染真实 sonner UI
  return {
    push_persistent_toast: vi.fn(),
    push_toast: vi.fn(),
  };
});

// runtime provider mock 是测试级共享夹具，集中保存跨用例复用的 mock 状态。
const runtime_provider_mock = vi.hoisted(() => {
  return {
    render_desktop_runtime_provider: vi.fn(),
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

vi.mock("@/app/navigation/schema", () => {
  return {
    DEFAULT_ROUTE_ID: "project-home",
    BOTTOM_ACTIONS: [],
    NAVIGATION_GROUPS: [],
  };
});

vi.mock("@/app/navigation/screen-registry", () => {
  return {
    SCREEN_REGISTRY: {
      "project-home": {
        title_key: "app.metadata.app_name",
        component: () => null,
      },
    },
  };
});

vi.mock("@/app/navigation/navigation-context", () => {
  return {
    AppNavigationProvider: (props: { children: ReactNode }) => <>{props.children}</>,
  };
});

vi.mock("@/app/desktop/desktop-runtime-context", () => {
  return {
    DesktopRuntimeProvider: (props: { children: ReactNode }) => {
      runtime_provider_mock.render_desktop_runtime_provider();
      return <>{props.children}</>;
    },
  };
});

vi.mock("@/app/page-runtime/project-pages-context", () => {
  return {
    ProjectPagesProvider: (props: { children: ReactNode }) => <>{props.children}</>,
  };
});

vi.mock("@/project/quality/quality-statistics-context", () => {
  return {
    QualityStatisticsProvider: (props: { children: ReactNode }) => <>{props.children}</>,
  };
});

vi.mock("@/app/desktop/use-desktop-runtime", () => {
  return {
    useDesktopRuntime: () => ({
      hydration_ready: true,
      pending_target_route: null,
      is_app_language_updating: false,
      project_snapshot: { loaded: false, path: "" },
      project_warmup_status: "idle",
      settings_snapshot: { app_language: "ZH" },
      task_snapshot: {
        runtime_revision: 0,
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

vi.mock("@/app/desktop/desktop-api", () => {
  return {
    api_fetch: vi.fn(async () => ({ settings: { app_language: "ZH" } })),
    check_github_release_update: vi.fn(async () => null),
    get_core_metadata: vi.fn(async () => ({ version: "9.8.7" })),
    open_external_url: vi.fn(async () => undefined),
    report_renderer_error: vi.fn(async () => undefined),
  };
});

vi.mock("@/app/ui-runtime/toast/use-desktop-toast", () => {
  return {
    DesktopProgressToastModalLayer: () => null,
    useDesktopToast: () => ({
      push_persistent_toast: toast_mock.push_persistent_toast,
      push_toast: toast_mock.push_toast,
    }),
  };
});

vi.mock("@/app/locale/locale-provider", () => {
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

vi.mock("@/shadcn/sidebar", () => {
  return {
    SidebarInset: (props: { children: ReactNode }) => <>{props.children}</>,
    SidebarProvider: (props: { children: ReactNode }) => <>{props.children}</>,
  };
});

vi.mock("@/shadcn/sonner", () => {
  return {
    Toaster: () => null,
  };
});

vi.mock("@/shadcn/tooltip", () => {
  return {
    TooltipProvider: (props: { children: ReactNode }) => <>{props.children}</>,
  };
});

vi.mock("@/app/shell/app-sidebar", () => {
  return {
    AppSidebar: () => null,
  };
});

vi.mock("@/app/shell/app-titlebar", () => {
  return {
    AppTitlebar: () => null,
  };
});

vi.mock("@/widgets/app-alert-dialog/app-alert-dialog", () => {
  return {
    AppAlertDialog: () => null,
  };
});

vi.mock("@/pages/log-window-page/page", () => {
  return {
    LogWindowPage: () => <div data-testid="log-window-page" />,
  };
});

// install_local_storage_fallback 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
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
  });

  // mount_app_at 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
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
        coreApi: {
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
});
