import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useProjectLoad } from "./use-project-load";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  state: {
    set_project_session_status: vi.fn(),
    refresh_project_snapshot: vi.fn(),
    refresh_settings: vi.fn(),
    refresh_batch_translation: vi.fn(),
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
  load = useProjectLoad();
  return null;
}
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.api.mockResolvedValue({});
  mocks.state.refresh_settings.mockReset().mockResolvedValue({});
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Probe />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
});

it("刷新快照前进入准备态，设置与任务刷新后等待首帧再结束加载", async () => {
  const settings = Promise.withResolvers<void>();
  mocks.state.refresh_settings.mockReturnValueOnce(settings.promise);
  const frame = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
  const finished = vi.fn();
  await act(async () => {
    void load({ message: "loading", request: async () => "E:/renamed.lg" }).then(finished);
  });
  expect(mocks.state.set_project_session_status).toHaveBeenCalledWith("warming");
  expect(mocks.state.set_project_session_status.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.state.refresh_project_snapshot.mock.invocationCallOrder[0]!,
  );
  expect(mocks.api).toHaveBeenCalledWith("/api/settings/recent-projects/add", {
    path: "E:/renamed.lg",
    name: "renamed",
  });
  expect(mocks.state.refresh_batch_translation).toHaveBeenCalledOnce();
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
  expect(mocks.state.set_project_session_status).not.toHaveBeenCalled();
  expect(mocks.state.refresh_project_snapshot).not.toHaveBeenCalled();
  expect(mocks.api).not.toHaveBeenCalled();
});
