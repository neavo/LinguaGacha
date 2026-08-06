import { describe, expect, it } from "vitest";

import {
  format_agent_skill_reference,
  format_agent_term_reference,
  normalize_agent_user_message_text,
} from "./agent";

describe("Agent 用户消息协议", () => {
  it("拒绝非字符串和纯空白，只裁剪有效正文外缘", () => {
    expect(normalize_agent_user_message_text(null)).toBeNull();
    expect(normalize_agent_user_message_text(["正文"])).toBeNull();
    expect(normalize_agent_user_message_text(" \n ")).toBeNull();
    expect(normalize_agent_user_message_text(" \n 先  用 \n处理 \t")).toBe("先  用 \n处理");
  });

  it("生成固定能力 marker 与原样 Unicode 术语 marker", () => {
    expect(format_agent_skill_reference("glossary-review")).toBe("@skill(glossary-review)");
    for (const term of ["エリス", "爱丽丝", "Alice Smith", "(hero) ✨"]) {
      expect(format_agent_term_reference(term)).toBe(`@term(${term})`);
    }
  });
});
