import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AgentPendingDecision,
  AgentQuestionResponse,
  AgentWriteApprovalDecision,
} from "@shared/agent";

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({
    locale: "zh-CN",
    t: (key: string, params?: Record<string, string>) =>
      params === undefined ? key : `${key}:${Object.values(params).join(",")}`,
  }),
}));

import { TooltipProvider } from "@frontend/shadcn/tooltip";
import { AgentDecisionLayer } from "./agent-decision";

describe("AgentDecisionLayer", () => {
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

  it("关联问题说明并提交固定选项", async () => {
    const on_resolve_question = vi.fn();
    await render_decision(root, question_decision(), on_resolve_question);
    const safe = action(container, "安全范围");
    const dialog = container.querySelector('[role="dialog"]');
    const description = container.querySelector<HTMLElement>(".agent-decision__description");

    expect(dialog?.getAttribute("aria-describedby")).toBe(description?.id);
    await act(async () => safe.click());
    expect(on_resolve_question).toHaveBeenCalledWith({ kind: "option", optionId: "safe" });
  });

  it("自定义单行输入由内嵌按钮提交", async () => {
    const on_resolve_question = vi.fn();
    await render_decision(root, question_decision(), on_resolve_question);
    const input = container.querySelector<HTMLInputElement>('[data-slot="input-group-control"]');
    const custom_badge = container.querySelector<HTMLLabelElement>(
      ".agent-decision-custom > label",
    );
    const confirm = container.querySelector<HTMLButtonElement>(
      'button[aria-label="agent_page.decision.confirm"]',
    );
    if (input === null || custom_badge === null || confirm === null) {
      throw new Error("缺少自定义操作");
    }

    expect(custom_badge.htmlFor).toBe(input.id);
    expect(confirm.disabled).toBe(true);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "  按章节处理  ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(confirm.disabled).toBe(false);
    await act(async () => confirm.click());
    expect(on_resolve_question).toHaveBeenCalledWith({ kind: "custom", text: "按章节处理" });
  });

  it("问题取消提交取消裁决", async () => {
    const on_resolve_question = vi.fn();
    await render_decision(root, question_decision(), on_resolve_question);
    const cancel = container.querySelector<HTMLButtonElement>(
      'button[aria-label="agent_page.decision.cancel"]',
    );
    if (cancel === null) throw new Error("缺少取消按钮");

    await act(async () => cancel.click());
    expect(on_resolve_question).toHaveBeenCalledWith({ kind: "cancel" });
  });

  it("写入授权只展示非零摘要并提交所选权限", async () => {
    const on_resolve_write_approval = vi.fn();
    await render_decision(
      root,
      {
        kind: "write_approval",
        id: "apply-1",
        expiresAt: Date.now() + 300_000,
        summary: {
          items: 12,
          glossary: 3,
          textPreserve: 1,
          preReplacement: 0,
          postReplacement: 0,
          prompts: 0,
        },
      },
      vi.fn(),
      on_resolve_write_approval,
    );
    const actions = [...container.querySelectorAll<HTMLButtonElement>(".agent-decision-action")];

    expect(actions).toHaveLength(3);
    expect(container.querySelectorAll(".agent-write-summary__item")).toHaveLength(3);
    expect(
      [...container.querySelectorAll(".agent-write-summary__value")].map(
        (value) => value.textContent,
      ),
    ).toEqual(["12", "3", "1"]);
    await act(async () => actions[1]?.click());
    expect(on_resolve_write_approval).toHaveBeenCalledWith("allow_once");
  });
});

async function render_decision(
  root: Root,
  decision: AgentPendingDecision | null,
  on_resolve_question: (response: AgentQuestionResponse) => void = () => undefined,
  on_resolve_write_approval: (decision: AgentWriteApprovalDecision) => void = () => undefined,
): Promise<void> {
  await act(async () =>
    root.render(
      <TooltipProvider>
        <AgentDecisionLayer
          decision={decision}
          on_resolve_question={on_resolve_question}
          on_resolve_write_approval={on_resolve_write_approval}
        />
      </TooltipProvider>,
    ),
  );
}

function question_decision(): AgentPendingDecision {
  return {
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
  };
}

function action(container: HTMLElement, label: string): HTMLButtonElement {
  const result = [...container.querySelectorAll<HTMLButtonElement>(".agent-decision-action")].find(
    (candidate) =>
      candidate.querySelector(".agent-decision-action__label")?.textContent?.trim() === label,
  );
  if (result === undefined) throw new Error(`缺少 ${label} 选项`);
  return result;
}
