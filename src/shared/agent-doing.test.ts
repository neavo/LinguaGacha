import { describe, expect, it } from "vitest";
import { normalize_agent_doing } from "./agent-doing";

describe("doing 文本边界", () => {
  it("修剪首尾空白、接受约定的 64 字符上限和 null 清空", () => {
    expect(normalize_agent_doing(" 检查章节\t")).toBe("检查章节");
    expect(normalize_agent_doing(` ${"x".repeat(64)} `)).toBe("x".repeat(64));
    expect(normalize_agent_doing(null)).toBeNull();
  });

  it("拒绝缺失值、非文本、空白文本和超长文本", () => {
    for (const value of [undefined, 1, false, "", " \t ", "x".repeat(65)]) {
      expect(() => normalize_agent_doing(value)).toThrow(TypeError);
    }
  });
});
