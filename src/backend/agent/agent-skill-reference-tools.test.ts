import { describe, expect, it } from "vitest";

import type { AgentSkillDefinition } from "./agent-skills";
import { create_skill_reference_tools } from "./agent-skill-reference-tools";

const skill: AgentSkillDefinition = {
  name: "glossary-audit",
  description: "审校术语",
  essentials: "执行术语审校。",
  reference_index: "## 参考资源\n- audit-standard.md: 审校标准",
  references: [
    { file_name: "audit-standard.md", summary: "审校标准", content: "# 审校标准\n\n完整正文。" },
  ],
};

function create_tool(get_skill: () => AgentSkillDefinition | null) {
  const tools = create_skill_reference_tools(get_skill);
  const tool = tools.find((candidate) => candidate.name === "read_skill_reference");
  if (tool === undefined) throw new Error("缺少 read_skill_reference");
  return tool;
}

describe("Agent 技能参考工具", () => {
  it("按当前激活技能返回 references 正文", async () => {
    const tool = create_tool(() => skill);

    const result = await tool.execute("t1", { reference: "audit-standard.md" });

    expect(result.details).toMatchObject({
      reference: "audit-standard.md",
      content: "# 审校标准\n\n完整正文。",
    });
  });

  it("白名单外或目录穿越的文件名被拒绝", async () => {
    const tool = create_tool(() => skill);

    await expect(tool.execute("t2", { reference: "missing.md" })).rejects.toThrow(
      "参考文件不存在或未加载",
    );
    await expect(tool.execute("t3", { reference: "../secret.md" })).rejects.toThrow(
      "参考文件不存在或未加载",
    );
  });

  it("当前没有激活技能时拒绝读取", async () => {
    const tool = create_tool(() => null);

    await expect(tool.execute("t4", { reference: "audit-standard.md" })).rejects.toThrow(
      "当前没有激活技能",
    );
  });
});
