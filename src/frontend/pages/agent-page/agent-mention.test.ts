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
  it("初始术语受限，筛选后扩大结果窗口并保持源顺序", () => {
    const initial = create_candidates("");
    const filtered = create_candidates("角色");

    expect(initial.skills).toHaveLength(skills.length);
    expect(initial.terms.length).toBeGreaterThan(0);
    expect(initial.terms.length).toBeLessThan(terms.length);
    expect(initial.terms.map((candidate) => candidate.title)).toEqual(
      terms.slice(0, initial.terms.length).map((term) => term.src),
    );
    expect(filtered.skills).toHaveLength(skills.length);
    expect(filtered.terms.length).toBeGreaterThan(initial.terms.length);
    expect(filtered.terms.length).toBeLessThan(terms.length);
    expect(filtered.terms.map((candidate) => candidate.title)).toEqual(
      terms.slice(0, filtered.terms.length).map((term) => term.src),
    );
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

  it("不把反斜线转义的 marker 投影为 mention", () => {
    const tokens = create_agent_mention_tokens(
      [
        {
          name: "glossary-review",
          displayDescriptions: { "zh-CN": "", "en-US": "", "de-DE": "" },
        },
      ],
      [],
    );

    expect(find_agent_mention_ranges(String.raw`\@skill(glossary-review)`, tokens)).toEqual([]);
  });
});
