import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@frontend/shadcn/tooltip";

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

import {
  AgentResponseAnnotationEditor,
  AgentResponseAnnotationSelection,
  AgentResponseAnnotationViewer,
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
    await act(async () => root?.render(createElement(TooltipProvider, null, view)));
    return container;
  }

  it("编辑器把评论变化和键盘操作交还给拥有者", async () => {
    const on_comment_change = vi.fn();
    const on_submit = vi.fn();
    const on_cancel = vi.fn();
    const view = await render_view(
      <AgentResponseAnnotationEditor
        aria-label="添加批注"
        selected_text="旧回复"
        comment="原评论"
        on_comment_change={on_comment_change}
        on_submit={on_submit}
        on_cancel={on_cancel}
      />,
    );
    const textarea = view.querySelector<HTMLTextAreaElement>("textarea");
    if (textarea === null) throw new Error("缺少批注输入");

    await act(async () => set_textarea_value(textarea, "新评论"));
    const submit_event = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    const newline_event = new KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    const composing_event = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(composing_event, "isComposing", { value: true });
    await act(async () => textarea.dispatchEvent(submit_event));
    await act(async () => textarea.dispatchEvent(newline_event));
    await act(async () => textarea.dispatchEvent(composing_event));
    await act(async () =>
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );

    expect(on_comment_change).toHaveBeenCalledWith("新评论");
    expect(on_submit).toHaveBeenCalledOnce();
    expect(on_cancel).toHaveBeenCalledOnce();
    expect(submit_event.defaultPrevented).toBe(true);
    expect(newline_event.defaultPrevented).toBe(false);
    expect(composing_event.defaultPrevented).toBe(false);
  });

  it("只读视图展示评论，空评论不生成占位", async () => {
    const view = await render_view(
      <AgentResponseAnnotationViewer
        aria-label="批注"
        selected_text="旧回复"
        comment="请更准确"
        on_cancel={vi.fn()}
      />,
    );
    expect(view.querySelector("blockquote")?.textContent).toBe("旧回复");
    expect(view.querySelector("p")?.textContent).toBe("请更准确");

    await act(async () =>
      root?.render(
        <AgentResponseAnnotationViewer
          aria-label="批注"
          selected_text="旧回复"
          comment=""
          on_cancel={vi.fn()}
        />,
      ),
    );
    expect(view.querySelector("p")).toBeNull();
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
      '[role="toolbar"][aria-label="agent_page.annotation.add"] button',
    );
    await act(async () => add_button?.click());
    const textarea = document.body.querySelector<HTMLTextAreaElement>(
      '[role="dialog"][aria-label="agent_page.annotation.add"] textarea',
    );
    if (textarea === null) throw new Error("缺少批注输入");
    await act(async () => set_textarea_value(textarea, "  请改写  "));
    const submit = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="app.action.save"]',
    );
    await act(async () => submit?.click());

    expect(on_add).toHaveBeenCalledWith({
      kind: "response_annotation",
      selectedText: "最终",
      comment: "请改写",
    });
    expect(window.getSelection()?.rangeCount).toBe(0);
  });

  it("操作条打开后允许在同一回复内重新选择文本", async () => {
    const view = await render_view(
      <AgentResponseAnnotationSelection disabled={false} on_add={vi.fn()}>
        <div data-agent-annotation-content="true">最终回复</div>
      </AgentResponseAnnotationSelection>,
    );
    const messages = view.querySelector<HTMLElement>(".agent-page__messages");
    const text_node = view.querySelector("[data-agent-annotation-content]")?.firstChild;
    if (messages === null || text_node === null || text_node === undefined) {
      throw new Error("缺少回复文本");
    }
    select_range(text_node, 0, text_node, 2);
    await act(async () => messages.dispatchEvent(new MouseEvent("pointerup", { bubbles: true })));
    await act(async () => {
      messages.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
      select_range(text_node, 0, text_node, 4);
      messages.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
      messages.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    });

    const add_button = document.body.querySelector<HTMLButtonElement>(
      '[role="toolbar"][aria-label="agent_page.annotation.add"] button',
    );
    await act(async () => add_button?.click());
    expect(
      document.body.querySelector(
        '[role="dialog"][aria-label="agent_page.annotation.add"] blockquote',
      )?.textContent,
    ).toBe("最终回复");

    await act(async () => {
      document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
      document.body.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    });
    expect(
      document.body.querySelector('[role="dialog"][aria-label="agent_page.annotation.add"]'),
    ).toBeNull();
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

    expect(document.body.querySelector('[role="toolbar"][aria-label="添加批注"]')).toBeNull();
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
