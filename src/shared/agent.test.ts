import { describe, expect, it } from "vitest";

import { format_agent_user_message_text, normalize_agent_user_message_parts } from "./agent";

describe("Agent 用户消息协议", () => {
  it("规范化有序 parts 并保留普通文本空白", () => {
    const parts = normalize_agent_user_message_parts([
      { kind: "text", text: "先 " },
      { kind: "text", text: "用 " },
      { kind: "skill", name: "glossary-audit" },
      { kind: "text", text: "\n处理" },
      { kind: "text", text: "" },
    ]);

    expect(parts).toEqual([
      { kind: "text", text: "先 用 " },
      { kind: "skill", name: "glossary-audit" },
      { kind: "text", text: "\n处理" },
    ]);
    expect(format_agent_user_message_text(parts ?? [])).toBe("先 用 @glossary-audit\n处理");
  });

  it("拒绝旧字段和非法 skill 名", () => {
    expect(normalize_agent_user_message_parts([{ kind: "text", value: "旧协议" }])).toBeNull();
    expect(normalize_agent_user_message_parts([{ kind: "skill", name: " bad " }])).toBeNull();
  });
});
