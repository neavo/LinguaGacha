import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({
    t: (key: string) =>
      ({
        "agent_page.annotation.add": "添加批注",
        "agent_page.annotation.remove": "删除",
        "agent_page.annotation.selected_text": "目标",
        "agent_page.annotation.user_comment": "批注",
        "agent_page.annotation.comment_placeholder": "写下评论",
        "app.action.close": "关闭",
      })[key] ?? key,
  }),
}));

import {
  AgentResponseAnnotationEditor,
  AgentResponseAnnotationSelection,
} from "./agent-response-annotation";

describe("AgentResponseAnnotation", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    window.getSelection()?.removeAllRanges();
    if (root !== null) await act(async () => root?.unmount());
    container?.remove();
    container = null;
    root = null;
  });

  async function render_view(view: ReactNode): Promise<HTMLDivElement> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(view));
    return container;
  }

  it("编辑器把评论变化、快捷提交和取消交还给拥有者", async () => {
    const on_comment_change = vi.fn();
    const on_submit = vi.fn();
    const on_cancel = vi.fn();
    const view = await render_view(
      <AgentResponseAnnotationEditor
        aria-label="添加批注"
        selected_text="旧回复"
        comment="原评论"
        submit_label="添加批注"
        on_comment_change={on_comment_change}
        on_submit={on_submit}
        on_cancel={on_cancel}
      />,
    );
    const textarea = view.querySelector<HTMLTextAreaElement>("textarea");
    if (textarea === null) throw new Error("缺少批注输入");

    await act(async () => set_textarea_value(textarea, "新评论"));
    await act(async () =>
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }),
      ),
    );
    await act(async () =>
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );

    expect(on_comment_change).toHaveBeenCalledWith("新评论");
    expect(on_submit).toHaveBeenCalledOnce();
    expect(on_cancel).toHaveBeenCalledOnce();
  });

  it("同一最终回复内的选区确认后成为规范批注附件", async () => {
    const on_add = vi.fn();
    const view = await render_view(
      <AgentResponseAnnotationSelection disabled={false} on_add={on_add}>
        <div data-agent-annotation-content="true">最终回复</div>
      </AgentResponseAnnotationSelection>,
    );
    const text_node = view.querySelector("[data-agent-annotation-content]")?.firstChild;
    if (text_node === null || text_node === undefined) throw new Error("缺少回复文本");
    select_range(text_node, 0, text_node, 2);

    await act(async () =>
      view
        .querySelector(".agent-page__messages")
        ?.dispatchEvent(new MouseEvent("pointerup", { bubbles: true })),
    );
    const add_button = document.body.querySelector<HTMLButtonElement>(
      '.agent-response-annotation-popover[role="toolbar"] button',
    );
    await act(async () => add_button?.click());
    const textarea = document.body.querySelector<HTMLTextAreaElement>(
      '.agent-response-annotation-popover[role="dialog"] textarea',
    );
    if (textarea === null) throw new Error("缺少批注输入");
    await act(async () => set_textarea_value(textarea, "  请改写  "));
    const submit = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("添加批注"),
    );
    await act(async () => submit?.click());

    expect(on_add).toHaveBeenCalledWith({
      kind: "response_annotation",
      selectedText: "最终",
      comment: "请改写",
    });
    expect(window.getSelection()?.rangeCount).toBe(0);
  });

  it("跨回复正文的选区不创建批注入口", async () => {
    const view = await render_view(
      <AgentResponseAnnotationSelection disabled={false} on_add={vi.fn()}>
        <div data-agent-annotation-content="true">第一段</div>
        <div data-agent-annotation-content="true">第二段</div>
      </AgentResponseAnnotationSelection>,
    );
    const surfaces = view.querySelectorAll("[data-agent-annotation-content]");
    const start = surfaces[0]?.firstChild;
    const end = surfaces[1]?.firstChild;
    if (start === null || start === undefined || end === null || end === undefined) {
      throw new Error("缺少回复文本");
    }
    select_range(start, 0, end, 2);

    await act(async () =>
      view
        .querySelector(".agent-page__messages")
        ?.dispatchEvent(new MouseEvent("pointerup", { bubbles: true })),
    );

    expect(document.body.querySelector(".agent-response-annotation-popover")).toBeNull();
  });
});

function set_textarea_value(textarea: HTMLTextAreaElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
    textarea,
    value,
  );
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function select_range(start: Node, start_offset: number, end: Node, end_offset: number): void {
  const range = document.createRange();
  range.setStart(start, start_offset);
  range.setEnd(end, end_offset);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}
