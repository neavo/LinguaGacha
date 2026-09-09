import { describe, expect, it, vi } from "vitest";

import { AgentDecisionCoordinator } from "./agent-decision";

describe("AgentDecisionCoordinator", () => {
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
    const on_change = vi.fn();
    const coordinator = new AgentDecisionCoordinator(on_change);
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
      outcome: "cancelled",
    });
    expect(coordinator.read_pending()).toBeNull();
    expect(on_change).toHaveBeenCalledTimes(4);
  });

  it("写入授权由宿主回答结束等待，并拒绝重复裁决", async () => {
    const coordinator = new AgentDecisionCoordinator(() => undefined);
    const result = coordinator.wait_for_write_approval(
      "write-1",
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
    coordinator.resolve_write_approval({ id: "write-1", decision: "allow_once" });
    expect(coordinator.read_pending()).toBeNull();
    await expect(result).resolves.toBe("allow_once");
    expect(() => coordinator.resolve_write_approval({ id: "write-1", decision: "reject" })).toThrow(
      "runtime.busy",
    );
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
