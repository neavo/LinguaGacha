import { describe, expect, it } from "vitest";

import type { AgentSkillDefinition } from "./agent-skills";
import { create_agent_skill_tools } from "./agent-skill-tools";

const auto_skill: AgentSkillDefinition = {
  name: "glossary-audit",
  description: "审校术语",
  content: "执行术语审校。",
  filePath: "E:/skills/glossary-audit/SKILL.md",
  disableModelInvocation: false,
  references: [
    {
      path: "references/audit-standard.md",
      filePath: "E:/skills/glossary-audit/references/audit-standard.md",
      content: "# 审校标准\n\n完整正文。",
    },
  ],
};

const manual_skill: AgentSkillDefinition = {
  name: "manual-only",
  description: "手动能力",
  content: "执行手动任务。",
  filePath: "E:/skills/manual-only/SKILL.md",
  disableModelInvocation: true,
  references: [],
};

function create_tool(is_manual_invoked = false) {
  const tools = create_agent_skill_tools(
    [auto_skill, manual_skill],
    (name) => is_manual_invoked && name === manual_skill.name,
  );
  const tool = tools.find((candidate) => candidate.name === "read_skill");
  if (tool === undefined) throw new Error("缺少 read_skill");
  return tool;
}

describe("Agent 技能读取工具", () => {
  it("按绝对白名单路径读取自动 skill 正文与 reference", async () => {
    const tool = create_tool();

    await expect(
      tool.execute("root", { path: auto_skill.filePath }, undefined, undefined, undefined as never),
    ).resolves.toMatchObject({
      details: {
        skill: "glossary-audit",
        path: auto_skill.filePath,
        content: "执行术语审校。",
      },
    });
    await expect(
      tool.execute(
        "reference",
        { path: auto_skill.references[0]?.filePath },
        undefined,
        undefined,
        undefined as never,
      ),
    ).resolves.toMatchObject({
      details: {
        skill: "glossary-audit",
        path: "E:/skills/glossary-audit/references/audit-standard.md",
        content: "# 审校标准\n\n完整正文。",
      },
    });
  });

  it("拒绝白名单外、目录穿越和未显式引用的 manual-only skill", async () => {
    const tool = create_tool();

    for (const path of [
      "E:/skills/glossary-audit/references/missing.md",
      "E:/skills/glossary-audit/../secret.md",
      manual_skill.filePath,
    ]) {
      await expect(
        tool.execute("rejected", { path }, undefined, undefined, undefined as never),
      ).rejects.toThrow("技能文件不存在或当前会话不可读取");
    }
  });

  it("显式引用后允许读取 manual-only skill", async () => {
    const tool = create_tool(true);

    await expect(
      tool.execute(
        "manual",
        { path: manual_skill.filePath },
        undefined,
        undefined,
        undefined as never,
      ),
    ).resolves.toMatchObject({
      details: {
        skill: "manual-only",
        path: manual_skill.filePath,
        content: "执行手动任务。",
      },
    });
  });

  it("没有 skill 时不注册读取工具", () => {
    expect(create_agent_skill_tools([], () => false)).toEqual([]);
  });

  it("读取工具使用 SDK 默认并行模式", () => {
    expect(create_agent_skill_tools([auto_skill], () => false)[0]?.executionMode).toBeUndefined();
  });
});
