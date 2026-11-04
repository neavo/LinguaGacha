import type { DesktopPathPickResult } from "@gui/bridge-types";
import { create_desktop_bridge_api_mock } from "../../../test/desktop-bridge-mock";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DesktopApiError } from "@frontend/app/desktop/desktop-api";
import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import type { RunProjectLoad } from "./use-project-load";
import { useProjectOpenFlow } from "./use-project-open-flow";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  loaded: vi.fn(),
  pick: vi.fn<() => Promise<DesktopPathPickResult>>(),
  error: vi.fn(),
  toast: vi.fn(),
  state: {
    refresh_settings: vi.fn(),
  },
}));
vi.mock("@frontend/app/desktop/desktop-api", async (original) => ({
  ...(await original<typeof import("@frontend/app/desktop/desktop-api")>()),
  api_fetch: mocks.api,
}));
vi.mock("@frontend/app/state/use-desktop-state", () => ({ useDesktopState: () => mocks.state }));
vi.mock("@frontend/app/feedback/desktop-toast", () => ({
  push_error_toast: mocks.error,
  push_toast: mocks.toast,
}));

let root: Root | null;
let desktop_descriptor: PropertyDescriptor | undefined;
/** 执行请求并记录交给公共加载流程的工程路径。 */
const run_project_load: RunProjectLoad = async ({ request }) => {
  mocks.loaded(await request());
};

let flow: ReturnType<typeof useProjectOpenFlow>;

/** 直接观察 Hook 的公开状态，页面测试负责控件接线与展示。 */
function Probe() {
  flow = useProjectOpenFlow(run_project_load);
  return null;
}

beforeEach(async () => {
  vi.clearAllMocks();
  desktop_descriptor = Object.getOwnPropertyDescriptor(window, "desktopApp");
  mocks.pick.mockReset().mockResolvedValue({ canceled: false, paths: ["E:/picked.lg"] });
  Object.defineProperty(window, "desktopApp", {
    configurable: true,
    value: create_desktop_bridge_api_mock({ methods: { pickProjectFilePath: mocks.pick } }),
  });
  mocks.api.mockReset().mockResolvedValue({});
  root = createRoot(document.createElement("div"));
  await act(async () =>
    root!.render(
      <LocaleProvider locale="zh-CN">
        <Probe />
      </LocaleProvider>,
    ),
  );
});
afterEach(async () => {
  await act(async () => root?.unmount());
  vi.restoreAllMocks();
  if (desktop_descriptor) Object.defineProperty(window, "desktopApp", desktop_descriptor);
  else Reflect.deleteProperty(window, "desktopApp");
});

it("同帧打开只受理一次，版本确认后重新核对并完成加载", async () => {
  const opened = Promise.withResolvers<never>();
  mocks.api.mockReturnValueOnce(opened.promise);
  act(() => {
    void flow.open_project("newer.lg");
    void flow.open_project("ignored.lg");
  });
  expect(mocks.api).toHaveBeenCalledTimes(1);
  await act(async () =>
    opened.reject(
      new DesktopApiError({
        code: "project.newer_app_version",
        details: { target_app_version: "2.1.0", current_app_version: "1.0.0" },
      }),
    ),
  );
  expect(flow.pending_confirmation).toMatchObject({
    path: "newer.lg",
    target_app_version: "2.1.0",
  });
  await act(async () => {
    await flow.confirm_open();
  });
  expect(mocks.api).toHaveBeenCalledWith("/api/session/project/open", {
    path: "newer.lg",
    confirmed_target_app_version: "2.1.0",
  });
  expect(flow.pending_confirmation).toBeNull();
});

it("最近工程缺失确认移除，移除失败保留恢复入口", async () => {
  mocks.api.mockRejectedValueOnce(new DesktopApiError({ code: "project.not_found" }));
  await act(async () => {
    await flow.open_project("missing.lg", true);
  });
  expect(flow.missing_recent_project?.path).toBe("missing.lg");
  expect(mocks.error).not.toHaveBeenCalled();
  const error = new Error("remove failed");
  mocks.api.mockRejectedValueOnce(error);
  await act(async () => flow.handle_recent_project_remove("missing.lg"));
  expect(flow.missing_recent_project?.path).toBe("missing.lg");
  expect(mocks.error).toHaveBeenCalledWith(expect.any(String), error);
  await act(async () => flow.handle_recent_project_remove("missing.lg"));
  expect(mocks.state.refresh_settings).toHaveBeenCalledOnce();
  expect(flow.missing_recent_project).toBeNull();
});

it("普通打开失败反馈错误并允许重试", async () => {
  const error = new DesktopApiError({ code: "project.not_found" });
  mocks.api.mockRejectedValueOnce(error);
  await act(async () => {
    await flow.open_project("picked.lg");
  });
  expect(flow.missing_recent_project).toBeNull();
  expect(mocks.error).toHaveBeenCalledWith(expect.any(String), error);
  await act(async () => {
    await flow.open_project("picked.lg");
  });
});

it("主动移除最近记录后刷新设置", async () => {
  await act(async () => flow.handle_recent_project_remove("E:/recent.lg"));
  expect(mocks.api).toHaveBeenCalledExactlyOnceWith("/api/settings/recent-projects/remove", {
    path: "E:/recent.lg",
  });
  expect(mocks.state.refresh_settings).toHaveBeenCalledOnce();
  expect(mocks.loaded).not.toHaveBeenCalled();
  expect(mocks.error).not.toHaveBeenCalled();
});

it("打开成功将工程路径交给加载流程并反馈设置对齐", async () => {
  mocks.api.mockResolvedValueOnce({
    settings_alignment: {
      settings: { mtool_optimizer_enable: true },
      changed: { mtool_optimizer_enable: true },
    },
  });
  await act(async () => {
    await flow.open_project("E:/renamed.lg");
  });
  expect(mocks.loaded).toHaveBeenCalledWith("E:/renamed.lg");
  expect(mocks.toast).toHaveBeenCalledWith("info", expect.stringContaining("MTool 优化器"));
});

it("文件窗口选中即加载，选择期间阻止重复打开且不请求预览", async () => {
  const picked = Promise.withResolvers<DesktopPathPickResult>();
  mocks.pick.mockReturnValueOnce(picked.promise);
  act(() => {
    void flow.open_project();
    void flow.open_project();
    void flow.open_project("ignored.lg", true);
  });
  expect(mocks.pick).toHaveBeenCalledOnce();
  expect(flow.is_opening_project).toBe(true);
  expect(mocks.api).not.toHaveBeenCalled();
  await act(async () => picked.resolve({ canceled: false, paths: ["E:/selected.lg"] }));
  expect(mocks.api).toHaveBeenCalledWith("/api/session/project/open", { path: "E:/selected.lg" });
  expect(mocks.api.mock.calls.map(([path]) => path)).toEqual(["/api/session/project/open"]);
  expect(flow.is_opening_project).toBe(false);
});

it.each([
  { canceled: true, paths: ["ignored.lg"] },
  { canceled: false, paths: [] },
])("取消或未选文件时结束打开意图：%j", async (result) => {
  mocks.pick.mockResolvedValueOnce(result);
  await act(async () => flow.open_project());
  expect(mocks.api).not.toHaveBeenCalled();
  expect(mocks.error).not.toHaveBeenCalled();
  expect(flow.is_opening_project).toBe(false);
});

it("文件窗口失败反馈错误，重试仍能选择并加载", async () => {
  const error = new Error("picker failed");
  mocks.pick.mockRejectedValueOnce(error);
  await act(async () => flow.open_project());
  expect(mocks.error).toHaveBeenCalledWith(expect.any(String), error);
  expect(flow.is_opening_project).toBe(false);
  await act(async () => flow.open_project());
  expect(mocks.api).toHaveBeenCalledWith("/api/session/project/open", { path: "E:/picked.lg" });
});
