vi.mock("@frontend/app/desktop/desktop-api", () => ({
  api_blob: async () => new Blob([], { type: "image/png" }),
  api_file_url: (path: string) => `http://localhost${path}`,
}));
import { uploaded_file } from "../../../test/agent-upload-fixture";
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@frontend/shadcn/tooltip";

vi.mock("@frontend/app/locale/locale-context", () => ({
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

  /** 保持真实附件组件与浮层，注入本例交互入口。 */
  async function render_attachments(props: AgentMessageAttachmentsProps): Promise<HTMLDivElement> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(createElement(TooltipProvider, null, <AgentMessageAttachments {...props} />)),
    );
    return container;
  }

  it("图片预览使用 Blob URL，卸载后释放地址", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    try {
      const view = await render_attachments({
        mode: "sent",
        attachments: [uploaded_file("preview")],
      });
      const source = view.querySelector("img")?.getAttribute("src");
      expect(source).toMatch(/^blob:/);
      await act(async () => root?.unmount());
      root = null;
      expect(revoke).toHaveBeenCalledWith(source);
    } finally {
      revoke.mockRestore();
    }
  });

  it("普通文件关联下载路径，草稿可直接移除", async () => {
    const on_remove = vi.fn();
    const file = { ...uploaded_file("document", null), name: "长 文件名.pdf", size: 128 };
    const view = await render_attachments({
      mode: "draft",
      attachments: [file],
      disabled: false,
      on_remove,
      on_retry: vi.fn(),
      on_update_annotation: vi.fn(),
    });
    expect(view.querySelector("a")?.textContent).toBe(file.name);
    expect(view.querySelector("a")?.getAttribute("href")).toContain("/api/agent/uploads/document");
    await act(async () => view.querySelector<HTMLButtonElement>("button")?.click());
    expect(on_remove).toHaveBeenCalledWith(0);
  });

  it("已发送附件保持添加顺序，并按类型打开只读详情", async () => {
    const view = await render_attachments({
      mode: "sent",
      attachments: [
        { kind: "response_annotation", selectedText: "旧回复片段", comment: "请更准确" },
        uploaded_file("webp-a"),
      ],
    });
    const buttons = view.querySelectorAll<HTMLButtonElement>("button[aria-label]");

    expect(buttons[1]?.querySelector("img")).not.toBeNull();
    expect(buttons[0]?.textContent).toBe("旧回复片段");
    await act(async () => buttons[0]?.click());

    const panel = document.body.querySelector(
      '[role="dialog"][aria-label="agent_page.annotation.title"]',
    );
    expect(panel?.querySelector("blockquote")?.textContent).toBe("旧回复片段");
    expect(panel?.textContent).toContain("请更准确");
    expect(panel?.querySelector("textarea")).toBeNull();
    expect(document.body.querySelector('[data-slot="dialog-overlay"]')).toBeNull();

    await act(async () => buttons[1]?.click());
    const dialog = document.body.querySelector('[data-slot="dialog-content"]');
    expect(dialog?.querySelector("img")).not.toBeNull();
    expect(
      [...document.body.querySelectorAll("button")].some(
        (button) => button.getAttribute("aria-label") === "app.action.delete",
      ),
    ).toBe(false);
  });

  it("草稿批注在面板保存，在附件块删除", async () => {
    const on_remove = vi.fn();
    const on_update_annotation = vi.fn();
    const view = await render_attachments({
      mode: "draft",
      on_retry: vi.fn(),
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
      (button) => button.getAttribute("aria-label") === "app.action.delete",
    );
    await act(async () => remove?.click());
    expect(on_remove).toHaveBeenCalledWith(0);
  });

  it("删除前面的附件后，已展开批注仍保存到当前位置", async () => {
    const file = uploaded_file("first");
    const annotation = {
      kind: "response_annotation" as const,
      selectedText: "引用原文",
      comment: "评论",
    };
    const on_update_annotation = vi.fn();
    const props: AgentMessageAttachmentsProps = {
      mode: "draft",
      attachments: [file, annotation],
      disabled: false,
      on_remove: vi.fn(),
      on_retry: vi.fn(),
      on_update_annotation,
    };
    const view = await render_attachments(props);
    await act(async () =>
      view
        .querySelector<HTMLButtonElement>('button[aria-label="agent_page.annotation.title 2"]')
        ?.click(),
    );
    await act(async () =>
      root?.render(
        <TooltipProvider>
          <AgentMessageAttachments {...props} attachments={[annotation]} />
        </TooltipProvider>,
      ),
    );
    expect(document.body.querySelector("blockquote")?.textContent).toBe("引用原文");
    await act(async () =>
      document.body
        .querySelector<HTMLButtonElement>('button[aria-label="app.action.save"]')
        ?.click(),
    );
    expect(on_update_annotation).toHaveBeenCalledWith(0, "评论");
  });

  it("附件块删除不打开图片预览，锁定草稿仍可预览但无法移除", async () => {
    const on_remove = vi.fn();
    const props: AgentMessageAttachmentsProps = {
      mode: "draft",
      attachments: [uploaded_file("preview")],
      disabled: false,
      on_remove,
      on_retry: vi.fn(),
      on_update_annotation: vi.fn(),
    };
    const view = await render_attachments(props);
    await act(async () =>
      view.querySelector<HTMLButtonElement>('button[aria-label="app.action.delete"]')?.click(),
    );
    expect(on_remove).toHaveBeenCalledExactlyOnceWith(0);
    expect(document.body.querySelector('[data-slot="dialog-content"]')).toBeNull();
    await act(async () =>
      root?.render(
        <TooltipProvider>
          <AgentMessageAttachments {...props} disabled />
        </TooltipProvider>,
      ),
    );
    const remove = view.querySelector<HTMLButtonElement>('button[aria-label="app.action.delete"]');
    expect(remove?.disabled).toBe(true);
    await act(async () => remove?.click());
    expect(on_remove).toHaveBeenCalledOnce();
    await act(async () =>
      view
        .querySelector<HTMLButtonElement>('button[aria-label="agent_page.image.title 1"]')
        ?.click(),
    );
    const dialog = document.body.querySelector('[data-slot="dialog-content"]');
    expect(dialog?.querySelector("img")).not.toBeNull();
    expect(dialog?.querySelector('button[aria-label="app.action.delete"]')).toBeNull();
  });
});

/** 通过原生输入事件通知 React 更新批注草稿。 */
function set_textarea_value(textarea: HTMLTextAreaElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
    textarea,
    value,
  );
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}
