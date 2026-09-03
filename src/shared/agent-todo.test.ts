import { describe, expect, it } from "vitest";

import { AGENT_TODO_ITEM_LIMIT, AGENT_TODO_TEXT_LIMIT, normalize_agent_todos } from "./agent-todo";

describe("Agent Todo", () => {
  it("规范化有序待办并保留重复事项", () => {
    expect(normalize_agent_todos([" 发现目标 ", "核验结果", "核验结果"])).toEqual([
      "发现目标",
      "核验结果",
      "核验结果",
    ]);
  });

  it("接受数量和文本长度边界", () => {
    expect(
      normalize_agent_todos(
        Array.from({ length: AGENT_TODO_ITEM_LIMIT }, () => "x".repeat(AGENT_TODO_TEXT_LIMIT)),
      ),
    ).toHaveLength(AGENT_TODO_ITEM_LIMIT);
  });

  it.each([
    ["非数组", null],
    ["非文本事项", [1]],
    ["空事项", [" "]],
    ["过长事项", ["x".repeat(AGENT_TODO_TEXT_LIMIT + 1)]],
    ["过多事项", Array.from({ length: AGENT_TODO_ITEM_LIMIT + 1 }, () => "待办")],
  ])("拒绝%s", (_label, value) => {
    expect(() => normalize_agent_todos(value)).toThrow();
  });
});
