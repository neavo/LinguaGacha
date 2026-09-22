import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@frontend/shadcn/tooltip";

vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

import {
  AgentResponseAnnotationEditor,
  AgentResponseAnnotationViewer,
} from "./agent-response-annotation";

describe("AgentResponseAnnotation", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root !== null) await act(async () => root?.unmount());
    container?.remove();
    container = null;
    root = null;
  });

  /** 挂载共用批注面板及其提示上下文。 */
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
});

/** 通过原生 setter 与 input 事件驱动 React 受控输入。 */
function set_textarea_value(textarea: HTMLTextAreaElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
    textarea,
    value,
  );
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}
