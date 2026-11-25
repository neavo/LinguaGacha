import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import { useProjectLoad } from "./use-project-load";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  error: vi.fn(),
  state: {
    refresh_projects: vi.fn(),
    before_open: vi.fn(async () => true),
    apply_settings_snapshot: vi.fn(),
  },
  show_project: vi.fn(),
}));
vi.mock("@frontend/app/desktop/desktop-api", () => ({ api_fetch: mocks.api }));
vi.mock("@frontend/app/state/use-desktop-state", () => ({ useDesktopState: () => mocks.state }));
vi.mock("@frontend/app/feedback/desktop-toast", () => ({
  push_error_toast: mocks.error,
  run_modal_progress_toast: ({ task }: { task: () => Promise<boolean> }) => task(),
}));

const opened_project = { projectId: "opened", path: "E:/renamed.lg" };
let root: Root;
let load: ReturnType<typeof useProjectLoad>;
/** 创建与打开只提交请求，加载时序由这个公开入口验证。 */
function Probe() {
  load = useProjectLoad(mocks.state.before_open, mocks.show_project);
  return null;
}
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.api.mockReset().mockResolvedValue({});
  mocks.state.refresh_projects.mockResolvedValue([{ snapshot: opened_project }]);
  root = createRoot(document.createElement("div"));
  await act(async () =>
    root.render(
      <LocaleProvider locale="zh-CN">
        <Probe />
      </LocaleProvider>,
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
});

it("按工程回执交接指令并应用最近工程设置", async () => {
  const snapshot = { settings: { recent_projects: [{ path: opened_project.path }] } };
  mocks.api.mockResolvedValueOnce(snapshot);
  const agent_input_request = { text: "导入原稿" };
  await expect(
    load({
      message: "loading",
      request: async () => ({ project: opened_project }),
      agent_input_request,
    }),
  ).resolves.toBe(true);
  expect(mocks.show_project).toHaveBeenCalledWith(opened_project.projectId, agent_input_request);
  expect(mocks.api).toHaveBeenCalledWith("/api/settings/recent-projects/add", {
    path: opened_project.path,
  });
  expect(mocks.state.apply_settings_snapshot).toHaveBeenCalledWith(snapshot);
});

it("离页保存被拒绝时结束加载意图", async () => {
  mocks.state.before_open.mockResolvedValueOnce(false);
  const request = vi.fn();
  await expect(load({ message: "loading", request })).resolves.toBe(false);
  expect(request).not.toHaveBeenCalled();
  expect(mocks.show_project).not.toHaveBeenCalled();
});

it("请求失败不改写会话或最近记录，错误交回所属流程", async () => {
  const error = new Error("request failed");
  await expect(
    load({
      message: "loading",
      request: async () => {
        throw error;
      },
    }),
  ).rejects.toBe(error);
  expect(mocks.show_project).not.toHaveBeenCalled();
  expect(mocks.api).not.toHaveBeenCalled();
});

it("登记最近工程失败时反馈错误，已交接的工程仍视为加载成功", async () => {
  const error = new Error("recent projects unavailable");
  mocks.api.mockRejectedValueOnce(error);
  await expect(
    load({
      message: "loading",
      request: async () => ({ project: opened_project }),
    }),
  ).resolves.toBe(true);
  expect(mocks.show_project).toHaveBeenCalledOnce();
  expect(mocks.error).toHaveBeenCalledWith(expect.any(String), error);
});
