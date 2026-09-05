import { describe, expect, it, vi } from "vitest";

import { AGENT_DECISION_TIMEOUT_MS, type AgentTranslationRequest } from "../../shared/agent";
import { AgentDecisionCoordinator } from "./agent-decision";
import { Model } from "../../domain/model";

const translation: AgentTranslationRequest = {
  currentProviderId: "model",
  providers: [
    {
      id: "model",
      name: "Model",
      type: "PRESET",
      agent_limits: { context_window: 128000, max_output_tokens: 32000 },
      thinking_level: "HIGH",
      available_thinking_levels: ["HIGH"],
    },
  ],
};
const selected_model = Model.from_json({ id: "model", thinking: { level: "HIGH" } }, "model");

describe("AgentDecisionCoordinator", () => {
  it("翻译回答只接受当前决定提供的接入点选择", async () => {
    const coordinator = new AgentDecisionCoordinator(() => undefined);
    const save = vi.fn(() => selected_model);
    const result = coordinator.wait_for_translation(
      "translation",
      translation,
      new AbortController().signal,
      save,
    );
    expect(() =>
      coordinator.resolve_translation({
        id: "translation",
        response: { kind: "provider", providerId: "unknown" },
      }),
    ).toThrow("request.validation_failed");
    expect(() =>
      coordinator.resolve_translation({
        id: "translation",
        response: { kind: "provider", providerId: "model", thinkingLevel: "HIGH" },
      }),
    ).toThrow("request.validation_failed");
    expect(save).not.toHaveBeenCalled();
    expect(coordinator.read_pending()?.id).toBe("translation");
    coordinator.resolve_translation({ id: "translation", response: { kind: "cancel" } });
    await expect(result).resolves.toMatchObject({ status: "not_started" });
  });
  it("保存失败保留决定，重试成功返回后端执行配置", async () => {
    const coordinator = new AgentDecisionCoordinator(() => undefined);
    const save = vi
      .fn(() => selected_model)
      .mockImplementationOnce(() => {
        throw new Error("disk full");
      });
    const result = coordinator.wait_for_translation(
      "translation",
      translation,
      new AbortController().signal,
      save,
    );
    const request = { id: "translation", response: { kind: "provider", providerId: "model" } };
    const before = coordinator.read_pending();
    expect(() => coordinator.resolve_translation(request)).toThrow("disk full");
    expect(coordinator.read_pending()).toEqual(before);
    coordinator.resolve_translation(request);
    expect(coordinator.read_pending()).toBeNull();
    await expect(result).resolves.toEqual({ status: "accepted", model: selected_model });
    expect(save).toHaveBeenLastCalledWith("model");
    expect(() => coordinator.resolve_translation(request)).toThrow("runtime.busy");
    expect(save).toHaveBeenCalledTimes(2);
  });

  it.each(["cancel", "expire", "abort"] as const)(
    "翻译等待的 %s 结束路径保留明确结果",
    async (action) => {
      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
      try {
        const coordinator = new AgentDecisionCoordinator(() => undefined);
        const controller = new AbortController();
        const save = vi.fn(() => selected_model);
        const result = coordinator.wait_for_translation(
          "translation",
          translation,
          controller.signal,
          save,
        );
        if (action === "cancel") {
          coordinator.resolve_translation({ id: "translation", response: { kind: "cancel" } });
          await expect(result).resolves.toEqual({ status: "not_started", reason: "cancelled" });
        } else if (action === "expire") {
          vi.setSystemTime(Date.now() + AGENT_DECISION_TIMEOUT_MS);
          expect(() =>
            coordinator.resolve_translation({
              id: "translation",
              response: { kind: "provider", providerId: "model" },
            }),
          ).toThrow("runtime.busy");
          await expect(result).resolves.toEqual({ status: "not_started", reason: "expired" });
        } else {
          const rejected = expect(result).rejects.toThrow("stopped");
          controller.abort(new Error("stopped"));
          await rejected;
        }
        expect(save).not.toHaveBeenCalled();
        expect(coordinator.read_pending()).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    },
  );
  it("公开问题并以用户选择原子结束等待", async () => {
    const changes: unknown[] = [];
    const coordinator = new AgentDecisionCoordinator(() =>
      changes.push(coordinator.read_pending()),
    );
    const result = coordinator.wait_for_question(
      "question-1",
      {
        prompt: "选择范围",
        options: [
          { id: "safe", label: "安全范围" },
          { id: "all", label: "完整范围" },
        ],
      },
      undefined,
    );

    expect(coordinator.read_pending()).toMatchObject({
      kind: "question",
      id: "question-1",
      question: { prompt: "选择范围" },
    });
    coordinator.resolve_question({
      id: "question-1",
      response: { kind: "option", optionId: "all" },
    });
    expect(coordinator.read_pending()).toBeNull();
    await expect(result).resolves.toEqual({
      outcome: "selected",
      optionId: "all",
    });
    expect(changes).toHaveLength(2);
  });

  it("接受裁剪后的自定义答案与显式取消", async () => {
    const coordinator = new AgentDecisionCoordinator(() => undefined);
    const custom = coordinator.wait_for_question(
      "custom",
      {
        prompt: "如何处理",
        options: [
          { id: "focused", label: "处理当前章节" },
          { id: "complete", label: "处理全部章节" },
        ],
      },
      undefined,
    );
    coordinator.resolve_question({
      id: "custom",
      response: { kind: "custom", text: "  按章节处理  " },
    });
    await expect(custom).resolves.toEqual({ outcome: "custom", text: "按章节处理" });

    const cancelled = coordinator.wait_for_question(
      "cancel",
      {
        prompt: "如何继续",
        options: [
          { id: "continue", label: "继续处理" },
          { id: "stop", label: "停止处理" },
        ],
      },
      undefined,
    );
    coordinator.resolve_question({ id: "cancel", response: { kind: "cancel" } });
    await expect(cancelled).resolves.toEqual({
      outcome: "unanswered",
      reason: "cancelled",
    });
  });

  it("问题到期返回未回答，写入授权到期返回拒绝", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const coordinator = new AgentDecisionCoordinator(() => undefined);
    const question = coordinator.wait_for_question(
      "question-timeout",
      {
        prompt: "选择范围",
        options: [
          { id: "safe", label: "安全范围" },
          { id: "all", label: "完整范围" },
        ],
      },
      undefined,
    );
    expect(coordinator.read_pending()?.expiresAt).toBe(Date.now() + AGENT_DECISION_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(AGENT_DECISION_TIMEOUT_MS);
    await expect(question).resolves.toEqual({
      outcome: "unanswered",
      reason: "expired",
    });

    const write = coordinator.wait_for_write_approval(
      "write-timeout",
      {
        items: 1,
        glossary: 0,
        textPreserve: 0,
        preReplacement: 0,
        postReplacement: 0,
        prompts: 0,
      },
      undefined,
    );
    await vi.advanceTimersByTimeAsync(AGENT_DECISION_TIMEOUT_MS);
    await expect(write).resolves.toBe("reject");
  });

  it("拒绝过期身份和无效答案且保留当前决定", async () => {
    const coordinator = new AgentDecisionCoordinator(() => undefined);
    const pending = coordinator.wait_for_question(
      "question-1",
      {
        prompt: "选择范围",
        options: [
          { id: "safe", label: "安全范围" },
          { id: "all", label: "完整范围" },
        ],
      },
      undefined,
    );

    expect(() =>
      coordinator.resolve_question({
        id: "old-question",
        response: { kind: "option", optionId: "safe" },
      }),
    ).toThrow("runtime.busy");
    expect(() =>
      coordinator.resolve_question({
        id: "question-1",
        response: { kind: "option", optionId: "unknown" },
      }),
    ).toThrow("request.validation_failed");
    expect(coordinator.read_pending()).toMatchObject({ id: "question-1" });
    coordinator.reset();
    await expect(pending).rejects.toThrow("runtime.cancelled");
  });
});
