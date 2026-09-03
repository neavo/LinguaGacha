import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentQuestionResponse } from "@shared/agent";

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params === undefined ? key : `${key}:${Object.values(params).join(",")}`,
  }),
}));

import { TooltipProvider } from "@frontend/shadcn/tooltip";
import { AgentQuestionDecision } from "./agent-question-decision";

describe("AgentQuestionDecision", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("固定选项点击后直接提交", async () => {
    const on_resolve = vi.fn(async () => undefined);
    await render_question(root, on_resolve);
    const safe = action("安全范围");
    const dialog = container.querySelector('[role="dialog"]');

    expect(container.textContent).toContain("选择最符合本次任务的范围");
    const description = container.querySelector<HTMLElement>(".agent-decision__description");
    expect(dialog?.getAttribute("aria-describedby")).toBe(description?.id);
    expect(on_resolve).not.toHaveBeenCalled();
    await act(async () => safe.click());
    expect(on_resolve).toHaveBeenCalledWith({ kind: "option", optionId: "safe" });
  });

  it("自定义单行输入始终可见并由内嵌按钮提交", async () => {
    const on_resolve = vi.fn(async () => undefined);
    await render_question(root, on_resolve);
    const input = container.querySelector<HTMLInputElement>('[data-slot="input-group-control"]');
    if (input === null) throw new Error("缺少自定义输入");
    const custom_badge = container.querySelector<HTMLLabelElement>(
      ".agent-decision-custom > label",
    );
    const confirm = container.querySelector<HTMLButtonElement>(
      'button[aria-label="agent_page.decision.confirm"]',
    );
    if (custom_badge === null || confirm === null) throw new Error("缺少自定义操作");

    expect(custom_badge.htmlFor).toBe(input.id);
    expect(confirm.disabled).toBe(true);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "  按章节处理  ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(confirm.disabled).toBe(false);
    await act(async () => confirm.click());
    expect(on_resolve).toHaveBeenCalledWith({ kind: "custom", text: "按章节处理" });
  });

  it("右上角取消按钮返回取消结果", async () => {
    const on_resolve = vi.fn(async () => undefined);
    await render_question(root, on_resolve);
    const cancel = container.querySelector<HTMLButtonElement>(
      'button[aria-label="agent_page.decision.cancel"]',
    );
    if (cancel === null) throw new Error("缺少取消按钮");
    await act(async () => cancel.click());
    expect(on_resolve).toHaveBeenCalledWith({ kind: "cancel" });
  });

  function action(label: string): HTMLButtonElement {
    const result = [
      ...container.querySelectorAll<HTMLButtonElement>(".agent-decision-action"),
    ].find(
      (candidate) =>
        candidate.querySelector(".agent-decision-action__label")?.textContent?.trim() === label,
    );
    if (result === undefined) throw new Error(`缺少 ${label} 选项`);
    return result;
  }
});

async function render_question(
  root: Root,
  on_resolve: (response: AgentQuestionResponse) => Promise<void>,
): Promise<void> {
  await act(async () =>
    root.render(
      <TooltipProvider>
        <AgentQuestionDecision
          decision={{
            kind: "question",
            id: "question-1",
            expiresAt: Date.now() + 300_000,
            question: {
              prompt: "选择处理范围",
              description: "选择最符合本次任务的范围",
              options: [
                { id: "safe", label: "安全范围" },
                { id: "all", label: "完整范围" },
              ],
            },
          }}
          on_resolve={on_resolve}
        />
      </TooltipProvider>,
    ),
  );
}
