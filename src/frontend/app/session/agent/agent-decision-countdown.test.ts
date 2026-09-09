import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentPendingDecision } from "@shared/agent";
import { AgentDecisionCountdown, AGENT_DECISION_TIMEOUT_MS } from "./agent-decision-countdown";

const question: AgentPendingDecision = {
  kind: "question",
  id: "question-1",
  question: {
    prompt: "处理范围",
    options: [
      { id: "one", label: "当前章节" },
      { id: "all", label: "全文" },
    ],
  },
};

describe("AgentDecisionCountdown", () => {
  let clock: AgentDecisionCountdown;
  const expire = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers();
    expire.mockReset();
    clock = new AgentDecisionCountdown(() => undefined, expire);
  });
  afterEach(() => {
    clock.sync(null, false);
    vi.useRealTimers();
  });

  it("聚焦保留毫秒余量，失焦续计且同一问题快照不重置时间", () => {
    clock.sync(question, true);
    vi.advanceTimersByTime(1_250);
    clock.set_focused(question.id, true);
    expect(clock.read()).toMatchObject({ remainingSeconds: 299, paused: true });
    vi.advanceTimersByTime(AGENT_DECISION_TIMEOUT_MS);
    clock.sync(structuredClone(question), true);
    expect(expire).not.toHaveBeenCalled();
    expect(clock.read()).toMatchObject({ remainingSeconds: 299, paused: true });
    clock.set_focused(question.id, false);
    vi.advanceTimersByTime(AGENT_DECISION_TIMEOUT_MS - 1_251);
    expect(expire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(expire).toHaveBeenCalledExactlyOnceWith(question);
    vi.advanceTimersByTime(AGENT_DECISION_TIMEOUT_MS);
    expect(expire).toHaveBeenCalledOnce();
  });

  it("断线冻结，恢复续计，新问题忽略旧焦点回调，清空释放时钟", () => {
    clock.sync(question, true);
    vi.advanceTimersByTime(60_000);
    clock.sync(question, false);
    vi.advanceTimersByTime(AGENT_DECISION_TIMEOUT_MS);
    expect(clock.read()).toMatchObject({ remainingSeconds: 240, paused: true });
    clock.sync(structuredClone(question), true);
    vi.advanceTimersByTime(1_000);
    expect(clock.read()).toMatchObject({ remainingSeconds: 239, paused: false });
    const next = { ...question, id: "question-2" };
    clock.sync(next, true);
    clock.set_focused(question.id, true);
    expect(clock.read()).toMatchObject({ id: next.id, remainingSeconds: 300, paused: false });
    clock.sync(null, true);
    vi.advanceTimersByTime(AGENT_DECISION_TIMEOUT_MS);
    expect(clock.read()).toBeNull();
    expect(expire).not.toHaveBeenCalled();
  });

  it("临界失焦只排队到期动作，手动受理可先结束计时且恢复快照不重试", () => {
    clock.sync(question, true);
    // 模拟浏览器尚未执行到期回调，焦点事件先到达。
    vi.setSystemTime(Date.now() + AGENT_DECISION_TIMEOUT_MS);
    clock.set_focused(question.id, true);
    clock.set_focused(question.id, false);
    expect(expire).not.toHaveBeenCalled();
    clock.stop(question.id);
    clock.sync(structuredClone(question), true);
    vi.advanceTimersByTime(AGENT_DECISION_TIMEOUT_MS);
    expect(expire).not.toHaveBeenCalled();
    expect(clock.read()).toBeNull();
  });
});
