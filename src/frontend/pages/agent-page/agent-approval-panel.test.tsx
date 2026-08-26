import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentPendingWriteSummary } from "@shared/agent";

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, string>) => {
      const messages: Record<string, string> = {
        "agent_page.approval.description": "writing {summary}",
        "agent_page.approval.summary_items": "items {count}",
        "agent_page.approval.summary_glossary": "glossary {count}",
        "agent_page.approval.summary_text_preserve": "text-preserve {count}",
        "agent_page.approval.summary_pre_replacement": "pre-replacement {count}",
        "agent_page.approval.summary_post_replacement": "post-replacement {count}",
        "agent_page.approval.summary_prompts": "prompts {count}",
        "agent_page.approval.summary_separator": "|",
        "agent_page.approval.summary_last_separator": "|",
      };
      const message = messages[key] ?? key;
      return Object.entries(values ?? {}).reduce(
        (result, [name, value]) => result.replace(`{${name}}`, value),
        message,
      );
    },
  }),
}));

import { AgentApprovalPanel } from "./agent-approval-panel";

const summary: AgentPendingWriteSummary = {
  items: 2,
  glossary: 1,
  textPreserve: 0,
  preReplacement: 0,
  postReplacement: 0,
  prompts: 0,
};

describe("AgentApprovalPanel", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root !== null) await act(async () => root?.unmount());
    container?.remove();
    container = null;
    root = null;
  });

  it("显示后端摘要并暴露审批决策", async () => {
    const on_approve = vi.fn();
    const on_reject = vi.fn();
    const view = await render_panel(summary, on_approve, on_reject);

    const counts = [...view.querySelectorAll<HTMLElement>(".agent-approval__change-count")];
    expect(counts.map((count) => count.textContent)).toEqual(["2", "1", "0", "0", "0", "0"]);
    expect(counts.filter((count) => count.dataset.changed === "true")).toHaveLength(2);
    expect(view.querySelector(".agent-approval__description-text")?.textContent).toBe(
      "writing items 2|glossary 1|text-preserve 0|pre-replacement 0|post-replacement 0|prompts 0",
    );

    const reject_button = view.querySelector<HTMLButtonElement>(
      "button[aria-keyshortcuts='Escape']",
    );
    const approve_button = view.querySelector<HTMLButtonElement>(
      "button[aria-keyshortcuts='Enter']",
    );
    const future_button = view.querySelector<HTMLButtonElement>(
      ".agent-approval__split button:not([aria-keyshortcuts])",
    );
    expect(reject_button).not.toBeNull();
    expect(approve_button).not.toBeNull();
    expect(future_button).not.toBeNull();
    reject_button?.click();
    approve_button?.click();
    expect(on_reject).toHaveBeenCalledOnce();
    expect(on_approve).toHaveBeenNthCalledWith(1, false);

    await act(async () => {
      future_button?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
      future_button?.click();
      await Promise.resolve();
    });
    const future_item = document.body.querySelector<HTMLElement>('[role="menuitem"]');
    await act(async () => future_item?.click());
    expect(on_approve).toHaveBeenNthCalledWith(2, true);
  });

  it("以 Escape 拒绝、Enter 允许一次且菜单打开时不误触", async () => {
    const on_approve = vi.fn();
    const on_reject = vi.fn();
    const view = await render_panel(summary, on_approve, on_reject);
    const approve_button = view.querySelector<HTMLButtonElement>(
      "button[aria-keyshortcuts='Enter']",
    );
    const future_button = view.querySelector<HTMLButtonElement>(
      ".agent-approval__split button:not([aria-keyshortcuts])",
    );

    approve_button?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(on_approve).not.toHaveBeenCalled();

    await act(async () => {
      future_button?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
      future_button?.click();
      await Promise.resolve();
    });
    document.body
      .querySelector<HTMLElement>('[role="menuitem"]')
      ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(on_reject).not.toHaveBeenCalled();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(on_reject).toHaveBeenCalledOnce();
    expect(on_approve).toHaveBeenCalledOnce();
    expect(on_approve).toHaveBeenCalledWith(false);
  });

  async function render_panel(
    approval_summary: AgentPendingWriteSummary,
    on_approve: (switch_to_auto: boolean) => void,
    on_reject: () => void,
  ): Promise<HTMLDivElement> {
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
    }
    root ??= createRoot(container);
    await act(async () =>
      root?.render(
        <AgentApprovalPanel
          summary={approval_summary}
          on_approve={on_approve}
          on_reject={on_reject}
        />,
      ),
    );
    return container;
  }
});
