import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgentFile } from "@shared/agent-workspace-file";
import { create_desktop_bridge_api_mock } from "../../../test/desktop-bridge-mock";
import { AgentFileContext } from "./agent-file-context";
import {
  resolve_agent_reference_file,
  useAgentFileAction,
  type AgentFileTarget,
} from "./use-agent-file-action";

const mocks = vi.hoisted(() => ({ api: vi.fn(), open: vi.fn(), toast: vi.fn() }));
vi.mock("@frontend/app/desktop/desktop-api", () => ({ api_fetch: mocks.api }));
vi.mock("@frontend/app/feedback/desktop-toast", () => ({
  push_error_toast: mocks.toast,
  push_toast: mocks.toast,
}));
vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

const file: AgentFile = { path: "work/report.md", name: "报告", kind: "file", preview: "markdown" };
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  mocks.api.mockReset().mockResolvedValue(file);
  mocks.open.mockClear();
  mocks.toast.mockClear();
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

/** 通过最小消费方执行文件动作，菜单操作由真实编辑器和时间线验证。 */
function FileActionProbe({ target }: { target: AgentFileTarget }) {
  const { run } = useAgentFileAction(target.path);
  return (
    <button type="button" onClick={() => void run(target)}>
      打开文件
    </button>
  );
}

/** 标签切换保留同一个消费方实例。 */
async function render(target: AgentFileTarget = { path: file.path }, active = true) {
  await act(async () =>
    root.render(
      <AgentFileContext value={{ open_file: mocks.open, chat_id: "session", active }}>
        <FileActionProbe target={target} />
      </AgentFileContext>,
    ),
  );
  return container.querySelector("button")!;
}

it("查询与另存共用一次打开操作，结束后按当前能力再次打开", async () => {
  const description = Promise.withResolvers<AgentFile>();
  const save = Promise.withResolvers<{ status: string }>();
  mocks.api.mockReturnValueOnce(description.promise).mockReturnValueOnce(save.promise);
  const trigger = await render();
  await act(async () => {
    trigger.click();
    trigger.click();
  });
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
  const description = Promise.withResolvers<AgentFile>();
  mocks.api.mockReturnValue(description.promise);
  const trigger = await render();
  await act(async () => trigger.click());
  await render(undefined, false);
  await act(async () => description.resolve(file));
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.toast).not.toHaveBeenCalled();
});

it("打开缺失文件时反馈原始错误", async () => {
  const missing = new Error("ENOENT");
  mocks.api.mockRejectedValue(missing);
  const trigger = await render();
  await act(async () => trigger.click());
  expect(mocks.toast).toHaveBeenCalledExactlyOnceWith("app.feedback.activate_link", missing);
  expect(mocks.open).not.toHaveBeenCalled();
});

it("本机引用按编码地址查询，工作区内的普通文件仍原地定位", async () => {
  const local_path = "E:/work/notes #1.txt";
  const reveal = vi.fn();
  vi.stubGlobal("desktopApp", create_desktop_bridge_api_mock({ methods: { revealPath: reveal } }));
  mocks.api.mockResolvedValue({ ...file, path: "work/notes%20%231.txt", preview: null });
  const target = resolve_agent_reference_file({ kind: "file", path: local_path })!;
  const trigger = await render(target);
  await act(async () => trigger.click());
  expect(mocks.api).toHaveBeenCalledExactlyOnceWith(
    "/api/agent/workspace/file",
    { path: "file:///E:/work/notes%20%231.txt", chatId: "session" },
    expect.any(AbortSignal),
  );
  expect(reveal).toHaveBeenCalledExactlyOnceWith(local_path);
});
