import { act, useEffect, type PropsWithChildren } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { usePageLeave } from "./navigation/page-leave-context";
import App from "./index";

const mocks = vi.hoisted(() => ({ save: vi.fn<() => Promise<boolean>>() }));

// 隔离启动网络和项目加载，保留真实更新状态、语言及页面保存流程。
vi.mock("./desktop/desktop-api", () => ({
  check_github_release_update: async () => ({
    latest_version: "1.2.4",
    release_url: "https://example.com/release",
    windows_zip_urls: {},
  }),
}));
vi.mock("./state/desktop-state-provider", () => ({
  DesktopStateProvider: ({ children }: PropsWithChildren) => children,
}));
vi.mock("./state/use-desktop-state", () => ({
  useDesktopState: () => ({
    initial_state_status: "loading",
    project_snapshot: { loaded: false, path: "" },
    project_session_status: "idle",
    settings_snapshot: { app_language: "ZH" },
  }),
  useBatchTranslationSnapshot: () => ({ progress: {} }),
}));
vi.mock("./navigation/screen-registry", () => ({
  SCREEN_REGISTRY: {
    "project-home": { component: () => null, title_key: "app.metadata.app_name" },
  },
}));
vi.mock("./appearance/appearance-provider", () => ({
  AppearanceProvider: ({ children }: PropsWithChildren) => children,
}));
vi.mock("./appearance/appearance-context", () => ({
  useAppearance: () => ({ resolved_theme: "light" }),
}));
vi.mock("./shell/app-sidebar", () => ({ AppSidebar: () => null }));
vi.mock("./shell/app-titlebar", () => ({ AppTitlebar: () => null }));
vi.mock("@frontend/shadcn/sidebar", () => ({
  SidebarProvider: ({ children }: PropsWithChildren) => children,
  SidebarInset: ({ children }: PropsWithChildren) => children,
}));
vi.mock("@frontend/widgets/app-content-state", () => ({
  /** 页面夹具注册真实离页保存动作。 */
  AppContentState: function SavingPage() {
    const { register_before_leave } = usePageLeave();
    useEffect(() => register_before_leave(mocks.save), [register_before_leave]);
    return null;
  },
}));
vi.mock("@frontend/widgets/app-alert-dialog", () => ({
  /** 保留用户确认操作，省去与更新时序无关的弹窗动画。 */
  AppActionDialog: ({
    open,
    submitting,
    primaryAction,
  }: {
    open: boolean;
    submitting: boolean;
    primaryAction: { onSelect: () => Promise<void> };
  }) =>
    open ? (
      <button disabled={submitting} onClick={() => void primaryAction.onSelect()}>
        确认
      </button>
    ) : null,
  AppConfirmDialog: () => null,
}));

// 保存时序直接决定更新是否会丢失当前页面草稿。
describe("应用更新入口", () => {
  it("等待页面保存，失败后可以重试，保存成功才调用更新宿主", async () => {
    const saved = Promise.withResolvers<boolean>();
    mocks.save.mockReturnValueOnce(saved.promise).mockResolvedValueOnce(true);
    const launch = vi.fn(async () => ({ status: "launched" }));
    const descriptor = Object.getOwnPropertyDescriptor(window, "desktopApp");
    Object.defineProperty(window, "desktopApp", {
      configurable: true,
      value: {
        appVersion: "1.2.3",
        shell: {},
        onWindowCloseRequest: () => () => {},
        reportRendererDiagnostics: () => {},
        downloadUpdate: async () => ({ status: "downloaded", zip_path: "update.zip" }),
        launchUpdate: launch,
      },
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () => root.render(<App />));
      // 第一次确认完成下载，第二次确认进入页面保存。
      await act(async () => container.querySelector("button")!.click());
      await act(async () => container.querySelector("button")!.click());
      expect(mocks.save).toHaveBeenCalledOnce();
      expect(launch).not.toHaveBeenCalled();
      await act(async () => saved.resolve(false));
      expect(launch).not.toHaveBeenCalled();
      await act(async () => container.querySelector("button")!.click());
      expect(launch).toHaveBeenCalledExactlyOnceWith({
        latest_version: "1.2.4",
        zip_path: "update.zip",
      });
    } finally {
      await act(async () => root.unmount());
      if (descriptor) Object.defineProperty(window, "desktopApp", descriptor);
      else Reflect.deleteProperty(window, "desktopApp");
    }
  });
});
