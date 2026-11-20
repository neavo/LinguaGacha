import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { AgentFileContext } from "./agent-file-context";
import { AgentFileTrigger } from "./agent-file-trigger";
import type { AgentFile } from "@shared/agent-workspace-file";

const mocks = vi.hoisted(() => ({ api: vi.fn(), open: vi.fn(), toast: vi.fn() }));
vi.mock("@frontend/app/desktop/desktop-api", () => ({ api_fetch: mocks.api }));
vi.mock("@frontend/app/feedback/desktop-toast", () => ({
  push_error_toast: mocks.toast,
  push_toast: mocks.toast,
}));
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
async function render(active = true, path = file.path) {
  await act(async () =>
    root.render(
      <AgentFileContext value={{ open_file: mocks.open, chat_id: "session", active }}>
        <AgentFileTrigger path={path} render={<button />}>
          报告
        </AgentFileTrigger>
      </AgentFileContext>,
    ),
  );
  return container.querySelector("button")!;
}

async function open_menu(trigger: HTMLElement): Promise<HTMLElement[]> {
  await act(async () =>
    trigger.dispatchEvent(new MouseEvent("contextmenu", { button: 2, bubbles: true })),
  );
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}

it.each(["markdown", null] as const)("执行时的预览能力 %s 决定打开行为", async (preview) => {
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
  const items = await open_menu(trigger);
  expect(items.map((item) => item.textContent)).toEqual([
    "agent_page.document.open",
    "agent_page.link.copy",
  ]);
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.api).not.toHaveBeenCalled();
  await act(async () => items[0]!.click());
  if (preview)
    expect(mocks.open).toHaveBeenCalledWith(file.path, expect.objectContaining({ preview }));
  else
    expect(mocks.api).toHaveBeenLastCalledWith("/api/agent/workspace/activate-path", {
      path: file.path,
    });
});
it("缺失文件仍能打开菜单并复制地址，执行打开时才报告错误", async () => {
  const href = "file:///E:/missing.md#section";
  const missing = new Error("ENOENT");
  const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
  mocks.api.mockRejectedValue(missing);
  const trigger = await render(true, href);
  const items = await open_menu(trigger);
  expect(items.map((item) => item.textContent)).toEqual([
    "agent_page.document.open",
    "agent_page.link.copy",
  ]);
  await act(async () => items[1]!.click());
  expect(copy).toHaveBeenCalledExactlyOnceWith(href);
  expect(mocks.toast).toHaveBeenCalledExactlyOnceWith("success", "agent_page.action.copied");
  expect(mocks.api).not.toHaveBeenCalled();
  const [open] = await open_menu(trigger);
  await act(async () => open!.click());
  expect(mocks.toast).toHaveBeenLastCalledWith("app.feedback.activate_link", missing);
  expect(mocks.open).not.toHaveBeenCalled();
});

it("查询与另存共用一次打开操作，取消后可以再次执行", async () => {
  const description = Promise.withResolvers<AgentFile>();
  const save = Promise.withResolvers<{ status: string }>();
  mocks.api.mockReturnValueOnce(description.promise).mockReturnValueOnce(save.promise);
  const trigger = await render();
  await act(async () => trigger.click());
  await act(async () => trigger.click());
  expect(mocks.api).toHaveBeenCalledOnce();
  await act(async () => description.resolve({ ...file, preview: null }));
  await act(async () => trigger.click());
  expect(mocks.api.mock.calls.map(([route]) => route)).toEqual([
    "/api/agent/workspace/file",
    "/api/agent/workspace/activate-path",
  ]);
  await act(async () => save.resolve({ status: "cancelled" }));
  expect(mocks.toast).not.toHaveBeenCalled();
  await act(async () => trigger.click());
  expect(mocks.open).toHaveBeenCalledExactlyOnceWith(file.path, file);
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
