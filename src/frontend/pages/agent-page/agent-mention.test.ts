import { describe, expect, it } from "vitest";

import {
  create_agent_mention_candidates,
  create_agent_mention_tokens,
  find_agent_mention_ranges,
} from "./agent-mention";

const skills = Array.from({ length: 24 }, (_, index) => ({
  name: `skill-${index.toString()}`,
  displayDescriptions: {
    "zh-CN": `角色能力 ${index.toString()}`,
    "en-US": `Character skill ${index.toString()}`,
    "de-DE": `Figurenf\u00e4higkeit ${index.toString()}`,
  },
}));
const terms = Array.from({ length: 24 }, (_, index) => ({
  entry_id: `term-${index.toString()}`,
  src: `Character ${index.toString()}`,
  dst: `角色 ${index.toString()}`,
  info: index === 0 ? "主角" : "配角",
  case_sensitive: false,
}));

function create_candidates(query: string): ReturnType<typeof create_agent_mention_candidates> {
  return create_agent_mention_candidates({
    query,
    locale: "zh-CN",
    skills,
    terms,
    term_hit_counts: { "term-0": 7 },
    format_term_hits: (count) => `${count.toString()} 次`,
  });
}

describe("Agent mention 菜单候选", () => {
  it("初始显示全部技能和前三条术语，筛选后保留全部技能和前二十条术语", () => {
    const initial = create_candidates("");
    const filtered = create_candidates("角色");

    expect(initial.skills).toHaveLength(24);
    expect(initial.terms.map((candidate) => candidate.title)).toEqual([
      "Character 0",
      "Character 1",
      "Character 2",
    ]);
    expect(filtered.skills).toHaveLength(24);
    expect(filtered.terms).toHaveLength(20);
    expect(filtered.terms.at(-1)?.title).toBe("Character 19");
  });

  it("按当前语言匹配全部展示字段，忽略没有源文的术语", () => {
    const candidates = create_agent_mention_candidates({
      query: "主角",
      locale: "zh-CN",
      skills: [],
      terms: [terms[0]!, { src: "", dst: "主角", info: "", case_sensitive: false }],
      term_hit_counts: { "term-0": 7 },
      format_term_hits: (count) => `${count.toString()} 次`,
    });

    expect(candidates.terms).toEqual([
      expect.objectContaining({
        title: "Character 0",
        description: "角色 0 \u00b7 主角 \u00b7 7 次",
      }),
    ]);
  });
});

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
