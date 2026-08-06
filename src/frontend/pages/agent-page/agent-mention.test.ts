import { describe, expect, it } from "vitest";

import { create_agent_mention_tokens, find_agent_mention_ranges } from "./agent-mention";

describe("Agent mention 视觉投影", () => {
  it("生成唯一 marker，并在括号术语前缀重叠时保留最长匹配", () => {
    const tokens = create_agent_mention_tokens(
      [
        {
          name: "glossary-review",
          displayDescriptions: { "zh-CN": "", "en-US": "", "de-DE": "" },
        },
      ],
      [
        { src: "Alice", dst: "", info: "", case_sensitive: false },
        { src: "Alice)", dst: "", info: "", case_sensitive: false },
        { src: "Alice", dst: "", info: "", case_sensitive: false },
      ],
    );
    const text = "@skill(glossary-review) 与 @term(Alice))";

    expect(tokens.map((token) => token.marker)).toEqual([
      "@skill(glossary-review)",
      "@term(Alice))",
      "@term(Alice)",
    ]);
    expect(find_agent_mention_ranges(text, tokens)).toEqual([
      { from: 0, to: 23, marker: "@skill(glossary-review)" },
      { from: 26, to: 39, marker: "@term(Alice))" },
    ]);
  });
});
