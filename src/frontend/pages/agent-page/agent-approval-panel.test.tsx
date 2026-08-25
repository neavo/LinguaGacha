import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentPendingWriteApproval } from "@shared/agent";

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, string>) => {
      const messages: Record<string, string> = {
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

const waiting: AgentPendingWriteApproval = {
  id: "apply-1",
  status: "waiting",
  summary: {
    items: 2,
    glossary: 1,
    textPreserve: 0,
    preReplacement: 0,
    postReplacement: 0,
    prompts: 0,
  },
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
    const view = await render_panel(waiting, on_approve, on_reject);

    const counts = [...view.querySelectorAll<HTMLElement>(".agent-approval__change-count")];
    expect(counts.map((count) => count.textContent)).toEqual(["2", "1", "0", "0", "0", "0"]);
    expect(counts.filter((count) => count.dataset.changed === "true")).toHaveLength(2);

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

  it("只在等待态以 Escape 拒绝、Enter 允许一次", async () => {
    const on_approve = vi.fn();
    const on_reject = vi.fn();
    const view = await render_panel(waiting, on_approve, on_reject);
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

    await render_panel({ ...waiting, status: "processing" }, on_approve, on_reject);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(on_reject).toHaveBeenCalledOnce();
    expect(on_approve).toHaveBeenCalledOnce();
    expect(
      [...view.querySelectorAll<HTMLButtonElement>("button")].every((button) => button.disabled),
    ).toBe(true);
  });

  async function render_panel(
    pending: AgentPendingWriteApproval,
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
        <AgentApprovalPanel pending={pending} on_approve={on_approve} on_reject={on_reject} />,
      ),
    );
    return container;
  }
});
