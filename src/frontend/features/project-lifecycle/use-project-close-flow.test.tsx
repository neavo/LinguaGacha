import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useProjectCloseFlow } from "./use-project-close-flow";
const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  error: vi.fn(),
  runtime: { projects: { project: { activeChatCount: 0 } } },
  prepare: vi.fn(async () => true),
  state: {
    project_snapshot: { loaded: true, projectId: "project" },
    refresh_projects: vi.fn(),
  },
}));
vi.mock("@frontend/app/desktop/desktop-api", () => ({ api_fetch: mocks.api }));
vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@frontend/app/feedback/desktop-toast", () => ({ push_error_toast: mocks.error }));
vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useDesktopState: () => mocks.state,
  useRuntimeSnapshot: () => mocks.runtime,
}));
vi.mock("@frontend/app/navigation/page-leave-context", () => ({
  usePageLeave: () => ({ prepare_page_leave: mocks.prepare }),
}));
let flow: ReturnType<typeof useProjectCloseFlow>;
let root: Root;
/** 公开确认状态承接关闭交互。 */
function Probe() {
  flow = useProjectCloseFlow();
  return null;
}
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.api.mockReset().mockResolvedValue({});
  mocks.runtime.projects.project.activeChatCount = 0;
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Probe />));
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it("确认期间出现运行占用时禁止关闭", async () => {
  act(() => flow.request_close());
  mocks.runtime.projects.project.activeChatCount = 1;
  await act(async () => root.render(<Probe />));
  expect(flow.can_close).toBe(false);
  await act(async () => flow.dialog_props.onConfirm());
  expect(mocks.api).not.toHaveBeenCalled();
});
it("关闭失败保留确认，重试成功后刷新并关闭", async () => {
  const error = new Error("failed");
  mocks.api.mockRejectedValueOnce(error);
  act(() => flow.request_close());
  await act(async () => flow.dialog_props.onConfirm());
  expect(mocks.error).toHaveBeenCalledWith("project.close.failed", error);
  expect(flow.dialog_props.open).toBe(true);
  await act(async () => flow.dialog_props.onConfirm());
  expect(mocks.prepare).toHaveBeenLastCalledWith({ kind: "project", projectId: "project" });
  expect(mocks.api).toHaveBeenLastCalledWith("/api/session/project/close", {
    projectId: "project",
  });
  expect(mocks.state.refresh_projects).toHaveBeenCalledOnce();
  expect(flow.dialog_props.open).toBe(false);
});
