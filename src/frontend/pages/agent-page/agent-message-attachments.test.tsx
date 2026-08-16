import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentMessageAttachment } from "@shared/agent";

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({
    t: (key: string) =>
      ({
        "agent_page.image.title": "图片",
        "agent_page.annotation.title": "批注",
        "agent_page.annotation.selected_text": "目标",
        "agent_page.annotation.user_comment": "批注",
        "app.action.close": "关闭",
      })[key] ?? key,
  }),
}));

import { AgentMessageAttachments } from "./agent-message-attachments";

describe("AgentMessageAttachments", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root !== null) await act(async () => root?.unmount());
    container?.remove();
    container = null;
    root = null;
  });

  async function render_attachments(
    attachments: readonly AgentMessageAttachment[],
  ): Promise<HTMLDivElement> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<AgentMessageAttachments attachments={attachments} />));
    return container;
  }

  it("图片优先展示，但详情仍按原附件索引读取完整内容", async () => {
    const view = await render_attachments([
      { kind: "response_annotation", selectedText: "旧回复片段", comment: "请更准确" },
      { kind: "image", webpBase64: "webp-a" },
    ]);
    const buttons = view.querySelectorAll<HTMLButtonElement>(".agent-attachment__open");

    expect(buttons[0]?.querySelector("img")?.alt).toBe("");
    expect(buttons[1]?.textContent).toBe("旧回复片段");
    await act(async () => buttons[1]?.click());

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.querySelector(".agent-message-attachment-detail__target")?.textContent).toBe(
      "旧回复片段",
    );
    expect(dialog?.querySelector(".agent-message-attachment-detail__comment")?.textContent).toBe(
      "请更准确",
    );
  });

  it("空评论不生成详情占位", async () => {
    const view = await render_attachments([
      { kind: "response_annotation", selectedText: "另一段旧回复", comment: "" },
    ]);

    await act(async () =>
      view.querySelector<HTMLButtonElement>(".agent-attachment__open")?.click(),
    );

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.querySelector(".agent-message-attachment-detail__target")?.textContent).toBe(
      "另一段旧回复",
    );
    expect(dialog?.querySelector(".agent-message-attachment-detail__comment")).toBeNull();
  });
});
