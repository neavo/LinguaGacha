import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useProjectLoad } from "./use-project-load";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  state: {
    refresh_projects: vi.fn(),
    select_project: vi.fn(),
    before_open: vi.fn(async () => true),
    refresh_settings: vi.fn(),
  },
}));
vi.mock("@frontend/app/desktop/desktop-api", () => ({ api_fetch: mocks.api }));
vi.mock("@frontend/app/state/use-desktop-state", () => ({ useDesktopState: () => mocks.state }));
vi.mock("@frontend/app/feedback/desktop-toast", () => ({
  run_modal_progress_toast: ({ task }: { task: () => Promise<void> }) => task(),
}));

let root: Root;
let load: ReturnType<typeof useProjectLoad>;
/** 创建与打开只提交请求，加载时序由这个公开入口验证。 */
function Probe() {
  load = useProjectLoad(mocks.state.before_open, mocks.state.select_project);
  return null;
}
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.api.mockResolvedValue({});
  mocks.state.refresh_projects.mockResolvedValue([
    { snapshot: { projectId: "opened", path: "E:/renamed.lg" } },
  ]);
  mocks.state.refresh_settings.mockReset().mockResolvedValue({});
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Probe />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
});

it("刷新列表后选中打开的工程，设置刷新与首帧完成后结束加载", async () => {
  const settings = Promise.withResolvers<void>();
  mocks.state.refresh_settings.mockReturnValueOnce(settings.promise);
  const frame = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
  const finished = vi.fn();
  await act(async () => {
    void load({ message: "loading", request: async () => "E:/renamed.lg" }).then(finished);
  });
  expect(mocks.state.refresh_projects).toHaveBeenCalledOnce();
  expect(mocks.state.select_project).toHaveBeenCalledWith({
    snapshot: { projectId: "opened", path: "E:/renamed.lg" },
  });
  expect(mocks.api).toHaveBeenCalledWith("/api/settings/recent-projects/add", {
    path: "E:/renamed.lg",
    name: "renamed",
  });
  expect(frame).not.toHaveBeenCalled();
  await act(async () => settings.resolve());
  expect(finished).not.toHaveBeenCalled();
  await act(async () => frame.mock.calls[0]![0](0));
  expect(finished).toHaveBeenCalledOnce();
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
  expect(mocks.state.refresh_projects).not.toHaveBeenCalled();
  expect(mocks.state.select_project).not.toHaveBeenCalled();
  expect(mocks.api).not.toHaveBeenCalled();
});
