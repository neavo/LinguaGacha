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
import { AgentDecision } from "./agent-decision";
import type { AgentDecisionCountdownSnapshot } from "@frontend/app/session/agent/agent-decision-countdown";

const session = vi.hoisted(() => ({
  countdown: null as AgentDecisionCountdownSnapshot,
  actions: { resolveQuestion: vi.fn(), resolveWriteApproval: vi.fn(), setQuestionFocused: vi.fn() },
}));
vi.mock("@frontend/app/session/agent/agent-session-context", () => ({
  useAgentDecisionCountdown: () => session.countdown,
  useAgentSessionActions: () => session.actions,
}));

describe("AgentDecision", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    session.actions.setQuestionFocused.mockReset();
    session.countdown = null;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("关联问题说明并提交固定选项", async () => {
    const on_resolve_question = vi.fn();
    await render_decision(root, question_decision(), on_resolve_question);
    const safe = action(container, "安全范围");
    expect(safe.querySelector(".agent-decision-progress")).not.toBeNull();
    expect(action(container, "完整范围").querySelector(".agent-decision-progress")).toBeNull();
    const region = container.querySelector<HTMLElement>(".agent-decision")!;
    const description = container.querySelector<HTMLElement>(".agent-decision__description")!;

    expect(region.getAttribute("aria-describedby")).toBe(description.id);
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
    await act(async () => input.focus());
    expect(session.actions.setQuestionFocused).toHaveBeenLastCalledWith("question-1", true);
    await act(async () => input.blur());
    expect(session.actions.setQuestionFocused).toHaveBeenLastCalledWith("question-1", false);
    expect(confirm.disabled).toBe(true);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "  按章节处理  ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(confirm.disabled).toBe(false);
    await act(async () => confirm.click());
    expect(on_resolve_question).toHaveBeenCalledWith({ kind: "custom", text: "按章节处理" });
    await act(async () => input.focus());
    await act(async () => root.render(null));
    expect(session.actions.setQuestionFocused).toHaveBeenLastCalledWith("question-1", false);
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

  it("写入授权在选项二显示倒计时并提交本次写入权限", async () => {
    const on_resolve_write_approval = vi.fn();
    await render_decision(
      root,
      {
        kind: "write_approval",
        id: "apply-1",
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

    expect(actions.filter((button) => button.querySelector(".agent-decision-progress"))).toEqual([
      actions[1],
    ]);
    expect(
      [...container.querySelectorAll(".agent-write-summary__value")].map(
        (value) => value.textContent,
      ),
    ).toEqual(["12", "3", "1"]);
    await act(async () => actions[1]?.click());
    expect(on_resolve_write_approval).toHaveBeenCalledWith("allow_once");
  });

  it.each(["question", "write_approval"] as const)(
    "%s 默认按钮的已打开提示跟随会话时钟更新",
    async (kind) => {
      vi.useFakeTimers();
      const decision: AgentPendingDecision =
        kind === "question"
          ? question_decision()
          : {
              kind,
              id: "write-tooltip",
              summary: {
                items: 1,
                glossary: 0,
                textPreserve: 0,
                preReplacement: 0,
                postReplacement: 0,
                prompts: 0,
              },
            };
      await render_decision(root, decision);
      const button = action(
        container,
        kind === "question" ? "安全范围" : "agent_page.approval.allow_once",
      );
      // 整个按钮是提示触发器，图标与文字共同命中。
      expect(button.dataset.slot).toBe("tooltip-trigger");
      await act(async () => {
        button.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
        button.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
        await vi.advanceTimersByTimeAsync(1);
      });
      const tooltip = document.querySelector('[role="tooltip"][data-open]');
      expect(tooltip?.textContent).toContain("agent_page.decision.remaining:05:00");
      // Store 发布新快照时，已经打开的浮层直接更新，无需重新悬停。
      session.countdown = {
        id: decision.id,
        remainingSeconds: 299,
        remainingPercent: 99,
        paused: false,
      };
      await render_decision(root, decision);
      expect(document.querySelector('[role="tooltip"][data-open]')).toBe(tooltip);
      expect(tooltip?.textContent).toContain("agent_page.decision.remaining:04:59");
      session.countdown = { ...session.countdown, paused: true };
      await render_decision(root, decision);
      expect(tooltip?.textContent).toContain("agent_page.decision.paused_remaining:04:59");
    },
  );
});

/** 在真实 Tooltip 宿主中渲染决定，裁决回调由各场景观察。 */
async function render_decision(
  root: Root,
  decision: AgentPendingDecision,
  on_resolve_question: (response: AgentQuestionResponse) => void = () => undefined,
  on_resolve_write_approval: (decision: AgentWriteApprovalDecision) => void = () => undefined,
): Promise<void> {
  session.actions.resolveQuestion.mockImplementation(on_resolve_question);
  session.actions.resolveWriteApproval.mockImplementation(on_resolve_write_approval);
  session.countdown ??= {
    id: decision.id,
    remainingSeconds: 300,
    remainingPercent: 100,
    paused: false,
  };
  await act(async () =>
    root.render(
      <TooltipProvider delay={0}>
        <AgentDecision decision={decision} />
      </TooltipProvider>,
    ),
  );
}

/** 固定选项与说明共同覆盖问题的提交和标题关联。 */
function question_decision(): AgentPendingDecision {
  return {
    kind: "question",
    id: "question-1",
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

/** 按可见动作标签定位选项，保留失败时的业务语义。 */
function action(container: HTMLElement, label: string): HTMLButtonElement {
  const result = [...container.querySelectorAll<HTMLButtonElement>(".agent-decision-action")].find(
    (candidate) =>
      candidate.querySelector(".agent-decision-action__label")?.textContent?.trim() === label,
  );
  if (result === undefined) throw new Error(`缺少 ${label} 选项`);
  return result;
}
