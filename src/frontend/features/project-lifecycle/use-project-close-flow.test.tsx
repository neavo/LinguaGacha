import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useProjectCloseFlow } from "./use-project-close-flow";
const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  remove: vi.fn(async (_path: string) => {}),
  error: vi.fn(),
  runtime: { projects: { project: { agent: false } } },
  prepare: vi.fn(async () => true),
  state: {
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
  flow = useProjectCloseFlow(mocks.remove);
  return null;
}
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.api.mockReset().mockResolvedValue({});
  mocks.runtime.projects.project.agent = false;
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Probe />));
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it("确认期间出现运行占用时禁止关闭", async () => {
  act(() => flow.request_close("project"));
  mocks.runtime.projects.project.agent = true;
  await act(async () => root.render(<Probe />));
  expect(flow.dialog_props.confirmDisabled).toBe(true);
  await act(async () => flow.dialog_props.onConfirm());
  expect(mocks.api).not.toHaveBeenCalled();
});
it("关闭失败保留确认，重试关闭成功后才移除最近记录", async () => {
  const error = new Error("close failed");
  const closed = Promise.withResolvers<unknown>();
  mocks.api.mockRejectedValueOnce(error).mockReturnValueOnce(closed.promise);
  act(() => flow.request_close("project", "E:/工程.lg"));
  await act(async () => flow.dialog_props.onConfirm());
  expect(mocks.error).toHaveBeenCalledWith("project.close.failed", error);
  expect(flow.dialog_props.open).toBe(true);
  expect(mocks.remove).not.toHaveBeenCalled();
  let pending: Promise<void>;
  await act(async () => {
    pending = flow.dialog_props.onConfirm();
  });
  expect(mocks.remove).not.toHaveBeenCalled();
  await act(async () => {
    closed.resolve({});
    await pending;
  });
  expect(mocks.remove).toHaveBeenCalledExactlyOnceWith("E:/工程.lg");
  expect(mocks.state.refresh_projects).toHaveBeenCalledOnce();
  expect(flow.dialog_props.open).toBe(false);
});
