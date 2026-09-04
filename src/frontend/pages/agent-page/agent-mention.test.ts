import { describe, expect, it } from "vitest";

import { create_agent_mention_candidates, create_agent_mention_tokens } from "./agent-mention";

const skills = [
  {
    name: "glossary-review",
    displayDescriptions: {
      "zh-CN": "审校术语",
      "en-US": "Review glossary",
      "de-DE": "Glossar prüfen",
    },
  },
];

function create_candidates(query: string) {
  return create_agent_mention_candidates({
    query,
    locale: "zh-CN",
    skills,
    instructions: [
      {
        id: "compact_context",
        title: "压缩上下文",
        description: "",
        disabled: false,
        execute: () => undefined,
      },
    ],
  });
}

describe("Agent mention 菜单候选", () => {
  it("按技能字段、本地化指令标题和稳定指令名筛选两个分组", () => {
    expect(create_candidates("")).toMatchObject({
      skills: [{ kind: "skill", title: "glossary-review" }],
      instructions: [{ kind: "instruction", title: "压缩上下文" }],
    });
    expect(create_candidates("术语").skills).toHaveLength(1);
    expect(create_candidates("压缩").instructions).toHaveLength(1);
    expect(create_candidates("compact").instructions).toHaveLength(1);
    expect(create_candidates("missing")).toEqual({ skills: [], instructions: [] });
  });
});

describe("Agent mention 视觉投影", () => {
  it("只为技能生成唯一 marker", () => {
    const tokens = create_agent_mention_tokens([...skills, ...skills]);
    expect(tokens).toEqual([{ marker: "@skill(glossary-review)" }]);
  });
});
