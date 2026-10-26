import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DesktopApiError } from "@frontend/app/desktop/desktop-api";
import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import type { ProjectPreviewResponse } from "@shared/project-preview";
import { build_project_translation_stats } from "@shared/project-translation-stats";
import { useProjectOpen } from "./use-project-open";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  error: vi.fn(),
  toast: vi.fn(),
  state: {
    set_project_session_status: vi.fn(),
    refresh_project_snapshot: vi.fn(),
    refresh_settings: vi.fn(),
    refresh_batch_translation: vi.fn(),
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
let flow: ReturnType<typeof useProjectOpen>;
const preview: ProjectPreviewResponse = {
  preview: {
    file_paths: [],
    created_at: "",
    updated_at: "",
    translation_stats: build_project_translation_stats([]),
  },
};

/** 直接观察 Hook 的公开状态，页面测试负责控件接线与展示。 */
function Probe() {
  flow = useProjectOpen(({ task }) => task());
  return null;
}

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.api.mockReset().mockResolvedValue(preview);
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
});

it("切换、清空和卸载隔离旧预览的成功、失败与收尾", async () => {
  const first = Promise.withResolvers<ProjectPreviewResponse>();
  const second = Promise.withResolvers<ProjectPreviewResponse>();
  const third = Promise.withResolvers<ProjectPreviewResponse>();
  mocks.api
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise)
    .mockReturnValueOnce(third.promise);
  act(() => {
    void flow.select_project_path("first.lg");
  });
  act(() => {
    void flow.select_project_path("second.lg", true);
  });
  await act(async () => first.resolve(preview));
  expect(flow.selected_project?.path).toBe("second.lg");
  expect(flow.preview_state.status).toBe("loading");
  act(() => flow.clear_selected_project());
  await act(async () => second.reject(new DesktopApiError({ code: "project.not_found" })));
  expect(flow.selected_project).toBeNull();
  expect(flow.preview_state.status).toBe("idle");
  expect(flow.missing_recent_project).toBeNull();
  act(() => {
    void flow.select_project_path("third.lg");
  });
  await act(async () => root!.unmount());
  root = null;
  await act(async () => third.reject(new Error("unmounted failure")));
  expect(mocks.error).not.toHaveBeenCalled();
  expect(mocks.api.mock.calls.every(([, , signal]) => signal.aborted)).toBe(true);
});

it("同帧打开只受理一次，取消和卸载结束确认意图", async () => {
  await act(async () => flow.select_project_path("newer.lg"));
  mocks.api.mockClear();
  const opened = Promise.withResolvers<never>();
  mocks.api.mockReturnValueOnce(opened.promise);
  act(() => {
    void flow.handle_open_project();
    void flow.handle_open_project();
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
  expect(mocks.error).not.toHaveBeenCalled();
  const confirm = flow.confirm_open; // 保存离页前的回调，验证迟到调用无法重新打开。
  act(() => flow.cancel_confirmation());
  await act(async () => {
    await flow.confirm_open();
  });
  expect(flow.selected_project?.path).toBe("newer.lg");
  await act(async () => root!.unmount());
  root = null;
  await confirm();
  expect(mocks.api).toHaveBeenCalledTimes(1);
});

it.each(["preview", "open"])("最近工程在 %s 缺失时结束打开意图并确认移除", async (stage) => {
  if (stage === "open") await act(async () => flow.select_project_path("missing.lg", true));
  mocks.api.mockRejectedValue(new DesktopApiError({ code: "project.not_found" }));
  await act(async () => {
    if (stage === "preview") await flow.select_project_path("missing.lg", true);
    else await flow.handle_open_project();
  });
  expect(flow.selected_project).toBeNull();
  expect(flow.preview_state.status).toBe("idle");
  expect(flow.is_opening_project).toBe(false);
  expect(flow.missing_recent_project?.path).toBe("missing.lg");
  expect(mocks.error).not.toHaveBeenCalled();
});

it("移除失败保留确认，重试成功后刷新记录并关闭确认", async () => {
  mocks.api.mockRejectedValueOnce(new DesktopApiError({ code: "project.not_found" }));
  await act(async () => flow.select_project_path("missing.lg", true));
  const error = new Error("remove failed");
  mocks.api.mockRejectedValueOnce(error);
  await act(async () => flow.handle_recent_project_remove("missing.lg"));
  expect(mocks.error).toHaveBeenCalledWith(expect.any(String), error);
  expect(flow.missing_recent_project?.path).toBe("missing.lg");
  expect(mocks.state.refresh_settings).not.toHaveBeenCalled();
  mocks.api.mockResolvedValue({});
  await act(async () => flow.handle_recent_project_remove("missing.lg"));
  expect(mocks.api).toHaveBeenLastCalledWith("/api/settings/recent-projects/remove", {
    path: "missing.lg",
  });
  expect(mocks.state.refresh_settings).toHaveBeenCalledOnce();
  expect(flow.missing_recent_project).toBeNull();
});

it("非最近来源缺失沿用普通错误处理且不提供移除确认", async () => {
  const error = new DesktopApiError({ code: "project.not_found" });
  mocks.api.mockRejectedValue(error);
  await act(async () => flow.select_project_path("picked.lg"));
  expect(flow.selected_project?.path).toBe("picked.lg");
  expect(flow.preview_state.status).toBe("failed");
  expect(flow.missing_recent_project).toBeNull();
  expect(mocks.error).toHaveBeenCalledWith(expect.any(String), error);
  mocks.error.mockClear();
  await act(async () => {
    await flow.handle_open_project();
  });
  expect(flow.selected_project?.path).toBe("picked.lg");
  expect(flow.missing_recent_project).toBeNull();
  expect(mocks.error).toHaveBeenCalledWith(expect.any(String), error);
});

it("打开成功后刷新会话，并消费后端设置对齐结果", async () => {
  await act(async () => flow.select_project_path("E:/renamed.lg"));
  mocks.api.mockResolvedValue({
    settings_alignment: {
      settings: { mtool_optimizer_enable: false },
      changed: { mtool_optimizer_enable: true },
    },
  });
  await act(async () => {
    await flow.handle_open_project();
  });
  expect(mocks.state.set_project_session_status).toHaveBeenCalledWith("warming");
  expect(mocks.state.refresh_project_snapshot).toHaveBeenCalledOnce();
  expect(mocks.state.refresh_settings).toHaveBeenCalledOnce();
  expect(mocks.state.refresh_batch_translation).toHaveBeenCalledOnce();
  expect(mocks.api).toHaveBeenLastCalledWith("/api/settings/recent-projects/add", {
    path: "E:/renamed.lg",
    name: "renamed",
  });
  expect(mocks.toast).toHaveBeenCalledWith("info", expect.stringContaining("MTool 优化器"));
});
