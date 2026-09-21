import { describe, expect, it } from "vitest";
import type { AgentFileCandidate } from "@shared/agent-reference";

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
  it.each(["", " \t "])("无筛选时按来源顺序展示前三个文件：%j", (query) => {
    const files: AgentFileCandidate[] = [
      { kind: "workspace", path: "z.txt", count: 1, unit: "items" },
      { kind: "workspace", path: "a.txt", count: 1, unit: "items" },
      { kind: "upload", path: "uploads/b.txt", size: 10 },
      { kind: "upload", path: "uploads/c.txt", size: 10 },
    ];
    const result = create_agent_mention_candidates({
      locale: "zh-CN",
      query,
      skills: [],
      instructions: [],
      files,
    });
    expect(result.files.map((file) => file.title)).toEqual(["z.txt", "a.txt", "uploads/b.txt"]);
  });

  it("搜索完整文件列表并限制展示数量", () => {
    const files: AgentFileCandidate[] = Array.from({ length: 60 }, (_, index) => ({
      kind: "workspace",
      path: `chapter-${index}.txt`,
      count: 1,
      unit: "items",
    }));
    const args = { locale: "zh-CN" as const, skills: [], instructions: [], files };
    const result = create_agent_mention_candidates({ ...args, query: "chapter" });
    expect(result.files.length).toBeLessThan(files.length);
    expect(create_agent_mention_candidates({ ...args, query: "chapter-59" }).files).toMatchObject([
      { title: "chapter-59.txt" },
    ]);
  });

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
    });
  });
});

it("工作区和上传文件按路径检索，并生成不同来源的引用", () => {
  const result = create_agent_mention_candidates({
    locale: "zh-CN",
    query: "资料 设定",
    skills: [],
    instructions: [],
    files: [
      { kind: "workspace", path: "资料/设定.xlsx", count: 3, unit: "items" },
      { kind: "upload", path: "uploads/资料_设定.xlsx", size: 128 },
    ],
  });
  expect(result.files.map((file) => (file.kind === "instruction" ? "" : file.insertText))).toEqual([
    '@workspace_file("资料/设定.xlsx")',
    '@upload_file("uploads/资料_设定.xlsx")',
  ]);
});
