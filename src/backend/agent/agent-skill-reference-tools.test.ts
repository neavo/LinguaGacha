import { describe, expect, it } from "vitest";

import type { AgentSkillDefinition } from "./agent-skills";
import { create_skill_reference_tools } from "./agent-skill-reference-tools";

const skill: AgentSkillDefinition = {
  name: "glossary-audit",
  description: "审校术语",
  content: "执行术语审校。",
  filePath: "E:/skills/glossary-audit/SKILL.md",
  references: [{ path: "references/audit-standard.md", content: "# 审校标准\n\n完整正文。" }],
};

function create_tool(resolve_skill: (name: string) => AgentSkillDefinition | null) {
  const tools = create_skill_reference_tools(resolve_skill);
  const tool = tools.find((candidate) => candidate.name === "read_skill_reference");
  if (tool === undefined) throw new Error("缺少 read_skill_reference");
  return tool;
}

describe("Agent 技能参考工具", () => {
  it("按显式 skill 与白名单路径返回 references 正文", async () => {
    const tool = create_tool((name) => (name === skill.name ? skill : null));

    const result = await tool.execute("t1", {
      skill: "glossary-audit",
      path: "references/audit-standard.md",
    });

    expect(result.details).toMatchObject({
      skill: "glossary-audit",
      path: "references/audit-standard.md",
      content: "# 审校标准\n\n完整正文。",
    });
  });

  it("白名单外或目录穿越的路径被拒绝", async () => {
    const tool = create_tool(() => skill);

    for (const path of ["references/missing.md", "../secret.md", "references/secret.txt"]) {
      await expect(tool.execute("t2", { skill: "glossary-audit", path })).rejects.toThrow(
        "参考文件不存在或未加载",
      );
    }
  });

  it("未在当前会话显式引用的 skill 被拒绝", async () => {
    const tool = create_tool(() => null);

    await expect(
      tool.execute("t4", {
        skill: "glossary-audit",
        path: "references/audit-standard.md",
      }),
    ).rejects.toThrow("能力未在当前会话显式引用");
  });
});
