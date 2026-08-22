import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@frontend/shadcn/tooltip";

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

import { AgentMessageAttachments } from "./agent-message-attachments";

type AgentMessageAttachmentsProps = ComponentProps<typeof AgentMessageAttachments>;

describe("AgentMessageAttachments", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root !== null) await act(async () => root?.unmount());
    container?.remove();
    container = null;
    root = null;
  });

  async function render_attachments(props: AgentMessageAttachmentsProps): Promise<HTMLDivElement> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(createElement(TooltipProvider, null, <AgentMessageAttachments {...props} />)),
    );
    return container;
  }

  it("已发送附件保持图片优先顺序，并按类型打开只读详情", async () => {
    const view = await render_attachments({
      mode: "sent",
      attachments: [
        { kind: "response_annotation", selectedText: "旧回复片段", comment: "请更准确" },
        { kind: "image", webpBase64: "webp-a" },
      ],
    });
    const buttons = view.querySelectorAll<HTMLButtonElement>("button[aria-label]");

    expect(buttons[0]?.querySelector("img")?.alt).toBe("");
    expect(buttons[1]?.textContent).toBe("旧回复片段");
    await act(async () => buttons[1]?.click());

    const panel = document.body.querySelector(
      '[role="dialog"][aria-label="agent_page.annotation.title"]',
    );
    expect(panel?.querySelector("blockquote")?.textContent).toBe("旧回复片段");
    expect(panel?.textContent).toContain("请更准确");
    expect(panel?.querySelector("textarea")).toBeNull();
    expect(document.body.querySelector('[data-slot="dialog-overlay"]')).toBeNull();

    await act(async () => buttons[0]?.click());
    const dialog = document.body.querySelector('[data-slot="dialog-content"]');
    expect(dialog?.querySelector("img")?.alt).toBe("");
    expect(
      [...document.body.querySelectorAll("button")].some(
        (button) => button.textContent === "app.action.delete",
      ),
    ).toBe(false);
  });

  it("草稿图片在统一预览弹窗中删除", async () => {
    const on_remove = vi.fn();
    const view = await render_attachments({
      mode: "draft",
      attachments: [{ kind: "image", webpBase64: "webp-a" }],
      disabled: false,
      on_remove,
      on_update_annotation: vi.fn(),
    });

    await act(async () =>
      view
        .querySelector<HTMLButtonElement>('button[aria-label="agent_page.image.title 1"]')
        ?.click(),
    );
    const dialog = document.body.querySelector('[data-slot="dialog-content"]');
    const remove = [...(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
      (button) => button.textContent === "app.action.delete",
    );
    await act(async () => remove?.click());

    expect(on_remove).toHaveBeenCalledWith(0);
    expect(document.body.querySelector('[data-slot="dialog-content"]')).toBeNull();
  });

  it("草稿批注在统一面板中保存和删除", async () => {
    const on_remove = vi.fn();
    const on_update_annotation = vi.fn();
    const view = await render_attachments({
      mode: "draft",
      attachments: [{ kind: "response_annotation", selectedText: "旧回复", comment: "原评论" }],
      disabled: false,
      on_remove,
      on_update_annotation,
    });

    const open = view.querySelector<HTMLButtonElement>(
      'button[aria-label="agent_page.annotation.title 1"]',
    );
    await act(async () => open?.click());
    const textarea = document.body.querySelector<HTMLTextAreaElement>(
      '[role="dialog"][aria-label="agent_page.annotation.edit"] textarea',
    );
    if (textarea === null) throw new Error("缺少批注编辑器");
    await act(async () => set_textarea_value(textarea, "  新评论  "));
    const save = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="app.action.save"]',
    );
    await act(async () => save?.click());
    expect(on_update_annotation).toHaveBeenCalledWith(0, "新评论");

    await act(async () => open?.click());
    const remove = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "agent_page.annotation.remove",
    );
    await act(async () => remove?.click());
    expect(on_remove).toHaveBeenCalledWith(0);
  });
});

function set_textarea_value(textarea: HTMLTextAreaElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
    textarea,
    value,
  );
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}
