import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { AgentFileContext } from "./agent-file-context";
import { AgentFileTrigger } from "./agent-file-trigger";
import type { AgentFile } from "@shared/agent-workspace-file";

const mocks = vi.hoisted(() => ({ api: vi.fn(), open: vi.fn(), toast: vi.fn() }));
vi.mock("@frontend/app/desktop/desktop-api", () => ({ api_fetch: mocks.api }));
vi.mock("@frontend/app/feedback/desktop-toast", () => ({ push_toast: mocks.toast }));
vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
let root: Root;
let container: HTMLDivElement;
const file: AgentFile = { path: "work/report.md", name: "报告", kind: "file", preview: "markdown" };
beforeEach(() => {
  mocks.api.mockReset();
  mocks.open.mockClear();
  mocks.toast.mockClear();
  mocks.api.mockImplementation(async (route) =>
    route.endsWith("/file") ? file : { status: "cancelled" },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
/** 使用真实菜单与点击入口，活动状态由所在标签提供。 */
async function render(active = true) {
  await act(async () =>
    root.render(
      <AgentFileContext value={{ open_file: mocks.open, chat_id: "session", active }}>
        <AgentFileTrigger path={file.path} render={<button />}>
          报告
        </AgentFileTrigger>
      </AgentFileContext>,
    ),
  );
  return container.querySelector("button")!;
}
it.each(["markdown", null] as const)("文件能力 %s 同时决定默认动作与右键菜单", async (preview) => {
  mocks.api.mockImplementation(async (route) =>
    route.endsWith("/file") ? { ...file, preview } : { status: "cancelled" },
  );
  const trigger = await render();
  await act(async () => trigger.click());
  if (preview)
    expect(mocks.open).toHaveBeenCalledWith(file.path, expect.objectContaining({ preview }));
  else
    expect(mocks.api).toHaveBeenLastCalledWith("/api/agent/workspace/activate-path", {
      path: file.path,
    });
  mocks.open.mockClear();
  mocks.api.mockClear();
  await act(async () =>
    trigger.dispatchEvent(new MouseEvent("contextmenu", { button: 2, bubbles: true })),
  );
  const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  expect(items.map((item) => item.textContent)).toEqual(
    preview
      ? ["agent_page.document.view", "agent_page.document.save_as"]
      : ["agent_page.document.save_as"],
  );
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.api.mock.calls.some(([route]) => route.endsWith("activate-path"))).toBe(false);
  await act(async () => items[0]!.click());
  if (preview)
    expect(mocks.open).toHaveBeenCalledWith(file.path, expect.objectContaining({ preview }));
  else
    expect(mocks.api).toHaveBeenLastCalledWith("/api/agent/workspace/activate-path", {
      path: file.path,
    });
});
it("保存确认期间合并点击，取消无提示，失败仅报告一次", async () => {
  let finish!: (value: { status: string }) => void;
  mocks.api.mockImplementation(async (route) =>
    route.endsWith("/file")
      ? { ...file, preview: null }
      : new Promise((resolve) => {
          finish = resolve;
        }),
  );
  const trigger = await render();
  await act(async () => trigger.click());
  await act(async () => trigger.click());
  expect(mocks.api.mock.calls.filter(([route]) => route.endsWith("activate-path"))).toHaveLength(1);
  await act(async () => finish({ status: "cancelled" }));
  expect(mocks.toast).not.toHaveBeenCalled();
  mocks.api.mockRejectedValueOnce(new Error("missing"));
  await act(async () => trigger.click());
  expect(mocks.toast).toHaveBeenCalledOnce();
});
it("离开标签取消能力读取，迟到响应不打开预览", async () => {
  let finish!: (value: AgentFile) => void;
  mocks.api.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const trigger = await render();
  await act(async () => trigger.click());
  await render(false);
  await act(async () => finish(file));
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.toast).not.toHaveBeenCalled();
});
it("右键目录不执行打开，左键沿用目录操作", async () => {
  mocks.api.mockResolvedValue({ ...file, kind: "directory", preview: null });
  const trigger = await render();
  await act(async () =>
    trigger.dispatchEvent(new MouseEvent("contextmenu", { button: 2, bubbles: true })),
  );
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(mocks.api.mock.calls.some(([route]) => route.endsWith("activate-path"))).toBe(false);
  await act(async () => trigger.click());
  expect(mocks.api).toHaveBeenLastCalledWith("/api/agent/workspace/activate-path", {
    path: file.path,
  });
});
