import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AgentPendingDecision,
  AgentQuestionResponse,
  AgentWriteApprovalDecision,
  AgentTranslationResponse,
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

  it("当前接入点点击即提交，保存失败后在原决定重试", async () => {
    const resolve = vi
      .fn()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValue(undefined);
    await render_decision(root, translation_decision(), undefined, undefined, resolve);
    expect(resolve).not.toHaveBeenCalled();
    await act(async () => action(container, "batch_translation.setup.current").click());
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    await act(async () => action(container, "batch_translation.setup.current").click());
    expect(resolve).toHaveBeenNthCalledWith(2, "translation", {
      kind: "provider",
      providerId: "a",
    });
  });

  it("没有其他接入点时禁用菜单入口，取消提交明确决定", async () => {
    const decision = translation_decision();
    decision.translation.providers = [];
    const resolve = vi.fn(async () => undefined);
    await render_decision(root, decision, undefined, undefined, resolve);
    expect(action(container, "batch_translation.setup.other").disabled).toBe(true);
    const cancel = container.querySelector<HTMLButtonElement>(
      'button[aria-label="agent_page.decision.cancel"]',
    )!;
    await act(async () => cancel.click());
    expect(resolve).toHaveBeenCalledWith("translation", { kind: "cancel" });
  });

  it("菜单收起后继续等待，选定接入点才提交翻译决定", async () => {
    const resolve = vi.fn(async () => undefined);
    await render_decision(root, translation_decision(), undefined, undefined, resolve);
    const trigger = action(container, "batch_translation.setup.other");
    await act(async () => trigger.click());
    expect(document.querySelector('[data-slot="dropdown-menu-content"][data-open]')).not.toBeNull();
    expect(resolve).not.toHaveBeenCalled();
    await act(async () =>
      trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(container.textContent).toContain("batch_translation.setup.current");
    expect(resolve).not.toHaveBeenCalled();
    await act(async () => trigger.click());
    await act(async () =>
      document.querySelector<HTMLDivElement>('[data-slot="dropdown-menu-sub-trigger"]')!.click(),
    );
    const provider = document.querySelector<HTMLDivElement>(
      '[data-slot="dropdown-menu-radio-item"]',
    );
    expect(provider?.textContent).toContain("模型 A");
    expect(provider?.getAttribute("aria-checked")).toBe("true");
    expect(
      document.querySelector('[data-slot="dropdown-menu-sub-trigger"][aria-current="true"]'),
    ).not.toBeNull();
    await act(async () => provider!.click());
    expect(resolve).toHaveBeenCalledWith("translation", { kind: "provider", providerId: "a" });
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
  on_resolve_translation: (
    id: string,
    response: AgentTranslationResponse,
  ) => Promise<void> = async () => undefined,
): Promise<void> {
  await act(async () =>
    root.render(
      <TooltipProvider>
        <AgentDecisionLayer
          decision={decision}
          on_resolve_question={on_resolve_question}
          on_resolve_write_approval={on_resolve_write_approval}
          on_resolve_translation={on_resolve_translation}
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

/** 提供一个可从快捷动作或分类菜单确认的翻译决定。 */
function translation_decision(): Extract<AgentPendingDecision, { kind: "batch_translation" }> {
  return {
    kind: "batch_translation",
    id: "translation",
    expiresAt: Date.now() + 300_000,
    translation: {
      currentProviderId: "a",
      providers: [
        {
          id: "a",
          name: "模型 A",
          type: "PRESET",
          agent_limits: { context_window: 128000, max_output_tokens: 32000 },
          thinking_level: "HIGH",
          available_thinking_levels: ["LOW", "HIGH"],
        },
      ],
    },
  };
}
