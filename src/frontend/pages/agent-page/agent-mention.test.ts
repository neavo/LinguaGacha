import { describe, expect, it } from "vitest";

import { create_agent_mention_candidates } from "./agent-mention";

const skills = [
  {
    name: "glossary-review",
    displayDescriptions: {
      "zh-CN": "审校术语",
      "en-US": "Review glossary",
      "de-DE": "Glossar prüfen",
      "ja-JP": "用語を校正",
      "ko-KR": "용어 교정",
    },
  },
];

/** 在同一个查询中提供技能和指令，验证两个分组的筛选。 */
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
  it("按当前语言的描述查询并展示技能", () => {
    expect(
      create_agent_mention_candidates({ locale: "ja-JP", query: "用語", skills, instructions: [] })
        .skills,
    ).toMatchObject([{ title: "glossary-review", description: "用語を校正" }]);
  });
  it("按技能字段、本地化指令标题和稳定指令名筛选两个分组", () => {
    expect(create_candidates("")).toMatchObject({
      skills: [{ kind: "skill", title: "glossary-review" }],
      instructions: [{ kind: "instruction", title: "压缩上下文" }],
    });
    expect(create_candidates("术语").skills).toHaveLength(1);
    expect(create_candidates("压缩").instructions).toHaveLength(1);
    expect(create_candidates("compact").instructions).toHaveLength(1);
    expect(create_candidates("missing")).toEqual({
      skills: [],
      files: [],
      instructions: [],
      fileCount: 0,
    });
  });
});

it("项目和上传文件按路径检索，并生成不同来源的引用", () => {
  const result = create_agent_mention_candidates({
    locale: "zh-CN",
    query: "资料 设定",
    skills: [],
    instructions: [],
    files: [
      { kind: "project", path: "资料/设定.xlsx", count: 3, unit: "items" },
      { kind: "upload", path: "uploads/资料_设定.xlsx", size: 128 },
    ],
  });
  expect(result.files.map((file) => (file.kind === "instruction" ? "" : file.insertText))).toEqual([
    '@project_file("资料/设定.xlsx")',
    '@upload_file("uploads/资料_设定.xlsx")',
  ]);
});
