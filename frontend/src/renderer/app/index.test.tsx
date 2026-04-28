import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "@/app/index";

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

vi.mock("@/app/runtime/desktop/desktop-runtime-context", () => {
  return {
    DesktopRuntimeProvider: (props: { children: ReactNode }) => <>{props.children}</>,
  };
});

vi.mock("@/app/runtime/project-pages/project-pages-context", () => {
  return {
    ProjectPagesProvider: (props: { children: ReactNode }) => <>{props.children}</>,
  };
});

vi.mock("@/app/project/quality/quality-statistics-context", () => {
  return {
    QualityStatisticsProvider: (props: { children: ReactNode }) => <>{props.children}</>,
  };
});

vi.mock("@/app/runtime/desktop/use-desktop-runtime", () => {
  return {
    useDesktopRuntime: () => ({
      hydration_ready: true,
      pending_target_route: null,
      is_app_language_updating: false,
      project_snapshot: { loaded: false, path: "" },
      project_warmup_status: "idle",
      settings_snapshot: { app_language: "ZH" },
      set_pending_target_route: vi.fn(),
      update_app_language: vi.fn(),
    }),
  };
});

vi.mock("@/app/runtime/toast/use-desktop-toast", () => {
  return {
    DesktopProgressToastModalLayer: () => null,
    useDesktopToast: () => ({
      push_persistent_toast: vi.fn(),
      push_toast: vi.fn(),
    }),
  };
});

vi.mock("@/i18n", () => {
  return {
    LocaleProvider: (props: { children: ReactNode }) => <>{props.children}</>,
    useI18n: () => ({
      t: (key: string) => key,
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

describe("App 字体模式同步", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

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
  });

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
});
