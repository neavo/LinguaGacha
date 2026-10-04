import { act, StrictMode, useEffect, useState, type JSX } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentMessageAttachments } from "./agent-message-attachments";
import { AgentMarkdown } from "./agent-markdown";
import { EditorView } from "@codemirror/view";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  blob: vi.fn(),
  toast: vi.fn(),
  mounts: vi.fn(),
  unmounts: vi.fn(),
  session: "session-1",
  needs_response: false,
  draft_attachment: false,
  saved: null as unknown,
  t: (key: string) => key,
  get: (): unknown => mocks.saved,
  set: (_key: string, value: unknown): void => {
    mocks.saved = value;
  },
}));
vi.mock("@frontend/app/desktop/desktop-api", () => ({
  api_fetch: mocks.api,
  open_external_url: vi.fn(),
  api_blob: mocks.blob,
}));
vi.mock("@frontend/app/feedback/desktop-toast", () => ({
  push_error_toast: mocks.toast,
  push_toast: mocks.toast,
}));
vi.mock("@frontend/app/locale/locale-context", () => ({ useI18n: () => ({ t: mocks.t }) }));
vi.mock("@frontend/app/appearance/appearance-context", () => ({
  useAppearance: () => ({ resolved_theme: "light" }),
}));
vi.mock("@frontend/app/navigation/navigation-context", () => ({
  useAppNavigation: () => ({ agent_input_request: null }),
}));
vi.mock("@frontend/app/session/agent/agent-chat-context", () => ({
  useAgentChatId: () => mocks.session,
  useAgentControls: () => ({ pendingDecision: mocks.needs_response ? { kind: "question" } : null }),
}));
vi.mock("@frontend/app/session/project-session-ui-state-context", () => ({
  useProjectSessionUiState: () => ({ get_page_ui_state: mocks.get, set_page_ui_state: mocks.set }),
}));
vi.mock("./agent-conversation", () => ({
  AgentConversation: function Conversation(): JSX.Element {
    const [attached, set_attached] = useState(mocks.draft_attachment);
    useEffect(() => {
      mocks.mounts();
      return () => {
        mocks.unmounts();
      };
    }, []);
    return (
      <div>
        <textarea defaultValue="草稿" />
        <AgentMessageAttachments
          mode="draft"
          disabled={false}
          attachments={
            attached
              ? [
                  {
                    kind: "file",
                    uploadId: "draft",
                    name: "chart.png",
                    path: "work/chart.png",
                    size: 1,
                    imageMimeType: "image/png",
                  },
                ]
              : []
          }
          on_remove={() => set_attached(false)}
          on_retry={() => undefined}
          on_update_annotation={() => undefined}
        />
        <AgentMarkdown
          text="[报告](work/report.md)\n\n[附件](work/other.md)\n\n[图片](work/chart.png)\n\n[文件](work/data.bin)\n\n[JSON](work/data.json)\n\n[JSONL](work/data.jsonl)"
          streaming={false}
        />
      </div>
    );
  },
}));

import { AgentPage } from "./page";

describe("Agent 文档标签", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    mocks.blob.mockReset();
    mocks.blob.mockResolvedValue(new Blob([new Uint8Array([0, 255])], { type: "image/png" }));
    mocks.session = "session-1";
    mocks.needs_response = false;
    mocks.draft_attachment = false;
    mocks.saved = null;
    mocks.mounts.mockClear();
    mocks.unmounts.mockClear();
    mocks.toast.mockClear();
    mocks.api.mockReset();
    mocks.api.mockImplementation(async (_route: string, body: { path: string }) => ({
      chatId: mocks.session,
      path: body.path,
      kind: "file",
      name: decodeURIComponent(body.path.split("/").at(-1)!),
      preview: body.path.endsWith(".png")
        ? "image"
        : body.path.endsWith(".bin")
          ? null
          : body.path.endsWith(".json")
            ? "json"
            : body.path.endsWith(".jsonl")
              ? "jsonl"
              : "markdown",
      content: /\.jsonl?$/u.test(body.path)
        ? '{"id":9007199254740993}'
        : "# 结论\n\n报告正文\n\n[下一份](./other.md)",
    }));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  /** 页面重渲染保留实例，用公开会话身份驱动切换。 */
  async function render(): Promise<void> {
    await act(async () => root.render(<AgentPage is_sidebar_collapsed={false} />));
  }
  /** 通过实际点击等待 React 更新完成。 */
  async function click(element: Element | null): Promise<void> {
    expect(element).not.toBeNull();
    await act(async () => (element as HTMLElement).click());
  }
  /** 真实文件入口打开标签，页面测试只观察标签与内容生命周期。 */
  async function open_link(path: string): Promise<void> {
    await click(container.querySelector(`a[href="${path}"]`));
  }
  /** 按可见文件名定位标签，避免耦合 Tooltip 的实现。 */
  function tab(path: string): Element | null {
    return (
      [...container.querySelectorAll('[role="tab"]')].find(
        (element) => element.textContent === decodeURIComponent(path.split("/").at(-1)!),
      ) ?? null
    );
  }

  it("打开、切换和关闭文档标签时保留对话实例", async () => {
    await render();
    const list = container.querySelector<HTMLElement>('[role="tablist"]')!;
    const input = container.querySelector("textarea")!;
    expect(list.hidden).toBe(true);
    await open_link("work/report.md");
    expect(list.hidden).toBe(false);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(input.closest<HTMLElement>('[role="tabpanel"]')?.hidden).toBe(true);
    expect(container.querySelectorAll(".agent-document textarea")).toHaveLength(0);
    await click(container.querySelector('[role="tab"]'));
    expect(container.querySelector("textarea")).toBe(input);
    expect(input.closest<HTMLElement>('[role="tabpanel"]')?.hidden).toBe(false);
    expect(mocks.mounts).toHaveBeenCalledOnce();
    await open_link("work/report.md");
    expect(container.querySelectorAll(".agent-document")).toHaveLength(1);
    await click(container.querySelector(".agent-pages__close"));
    expect(list.hidden).toBe(true);
    expect(mocks.unmounts).not.toHaveBeenCalled();
  });

  it.each(["json", "jsonl"])("%s 链接打开预览，重新打开复用标签并读取新内容", async (format) => {
    await render();
    const path = `work/data.${format}`;
    await open_link(path);
    const view = EditorView.findFromDOM(
      container.querySelector(".agent-code-document .cm-content")!,
    )!;
    expect(tab(path)?.getAttribute("aria-selected")).toBe("true");
    expect(
      mocks.api.mock.calls.some(([route]) => route === "/api/agent/workspace/activate-path"),
    ).toBe(false);
    await click(container.querySelector('[role="tab"]'));
    const original = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation(async (route, body) => ({
      ...(await original(route, body)),
      content: '{"updated":true}',
    }));
    await open_link(path);
    expect(container.querySelectorAll(".agent-code-document")).toHaveLength(1);
    expect(JSON.parse(view.state.doc.toString())).toEqual({ updated: true });
    expect(tab(path)?.getAttribute("aria-selected")).toBe("true");
  });

  it("文档配图通过会话资源接口读取，关闭页面释放 Blob", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    try {
      await render();
      mocks.api.mockImplementation(async (_route: string, body: { path: string }) => ({
        chatId: "session-1",
        path: body.path,
        name: "report.md",
        kind: "file",
        preview: "markdown",
        content: "![配图](./chart%20%23.png)",
      }));
      await open_link("work/report.md");
      const source = container.querySelector(".agent-document img")?.getAttribute("src");
      expect(source).toMatch(/^blob:/);
      const request = new URL(mocks.blob.mock.calls[0]![0] as string, "http://localhost");
      expect(request.searchParams.get("path")).toBe("work/chart%20%23.png");
      expect(request.searchParams.get("chatId")).toBe("session-1");
      await click(container.querySelector(".agent-pages__close"));
      expect(revoke).toHaveBeenCalledWith(source);
    } finally {
      revoke.mockRestore();
    }
  });

  it("图片进入独立标签，重复打开复用画布，关闭释放资源", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    try {
      await render();
      await open_link("work/chart.png");
      const image = container.querySelector(".media-viewport__viewport img")!;
      expect(image.getAttribute("src")).toMatch(/^blob:/);
      expect(tab("work/chart.png")?.getAttribute("aria-selected")).toBe("true");
      await click(container.querySelector('[role="tab"]'));
      await open_link("work/chart.png");
      expect(container.querySelectorAll(".media-viewport__viewport")).toHaveLength(1);
      await click(container.querySelector(".agent-pages__close"));
      expect(revoke).toHaveBeenCalledWith(image.getAttribute("src"));
    } finally {
      revoke.mockRestore();
    }
  });

  it("待回复仅在对话未激活时提示，切回隐藏、离开恢复且不追加文本", async () => {
    await render();
    await open_link("work/report.md");
    const conversation = container.querySelector('[role="tab"]')!;
    const title = conversation.textContent;
    expect(conversation.hasAttribute("data-needs-response")).toBe(false);
    mocks.needs_response = true;
    await render();
    expect(conversation.hasAttribute("data-needs-response")).toBe(true);
    expect(conversation.textContent).toBe(title);
    await click(conversation);
    expect(conversation.hasAttribute("data-needs-response")).toBe(false);
    await click(tab("work/report.md"));
    expect(conversation.hasAttribute("data-needs-response")).toBe(true);
    mocks.needs_response = false;
    await render();
    expect(conversation.hasAttribute("data-needs-response")).toBe(false);
    expect(conversation.textContent).toBe(title);
  });

  it("草稿图片打开标签后保留输入与选区，移除引用不关闭预览且正文入口复用标签", async () => {
    mocks.draft_attachment = true;
    await render();
    const input = container.querySelector("textarea")!;
    input.value = "继续编辑的草稿";
    input.setSelectionRange(2, 5);
    await click(container.querySelector(".agent-attachment__body"));
    expect(tab("work/chart.png")?.getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull();
    await click(container.querySelector('[role="tab"]'));
    expect(container.querySelector("textarea")).toBe(input);
    expect(input.value).toBe("继续编辑的草稿");
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 5]);
    await click(container.querySelector(".agent-attachment__remove"));
    expect(container.querySelector(".agent-attachment")).toBeNull();
    expect(tab("work/chart.png")).not.toBeNull();
    await open_link("work/chart.png");
    expect(container.querySelectorAll(".media-viewport__viewport")).toHaveLength(1);
    expect(tab("work/chart.png")?.getAttribute("aria-selected")).toBe("true");
  });

  it.each([
    ["work/report.md", ".agent-document"],
    ["work/data.jsonl", ".agent-code-document .cm-scroller"],
  ])("%s 离开再回来按轻量记录恢复，在 StrictMode 重连时仍保留标签", async (path, selector) => {
    await render();
    await open_link(path);
    const viewport = container.querySelector<HTMLElement>(selector)!;
    viewport.scrollTop = 80;
    await act(async () => viewport.dispatchEvent(new Event("scroll", { bubbles: true })));
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () =>
      root.render(
        <StrictMode>
          <AgentPage is_sidebar_collapsed={false} />
        </StrictMode>,
      ),
    );
    expect(container.querySelector(selector)?.scrollTop).toBe(80);
    expect(tab(path)?.getAttribute("aria-selected")).toBe("true");
  });
});
