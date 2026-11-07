import { agent_tool_call } from "../../../test/agent-tool-fixture";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { type AgentSkillDefinition } from "../agent-skills";
import { create_agent_read_skill_tool } from "./read-skill";

describe("Agent 技能读取工具", () => {
  it("按名称读取会话 skill 的默认正文和包内相对文件", async () => {
    using fixture = create_fixture("builtin", "shared", "内置正文");
    write_file(path.join(fixture.builtin_root, "shared", "references", "guide.md"), "参考正文");
    const base_url = pathToFileURL(path.join(fixture.builtin_root, "shared") + path.sep).href;

    await expect(execute(fixture.tool, { name: "shared" })).resolves.toMatchObject({
      details: {
        name: "shared",
        path: "SKILL.md",
        content: expect.stringContaining("内置正文"),
        base_url,
      },
    });
    await expect(
      execute(fixture.tool, { name: "shared", path: "references/guide.md" }),
    ).resolves.toMatchObject({
      details: { name: "shared", path: "references/guide.md", content: "参考正文", base_url },
    });
  });

  it("每次读取当前集合指定的包及磁盘正文", async () => {
    using fixture = create_fixture("builtin", "shared", "会话内置正文");
    write_skill(fixture.user_root, "shared", "后来新增的用户正文");

    await expect(execute(fixture.tool, { name: "shared" })).resolves.toMatchObject({
      details: {
        content: expect.stringContaining("会话内置正文"),
        base_url: pathToFileURL(path.join(fixture.builtin_root, "shared") + path.sep).href,
      },
    });
    write_skill(fixture.builtin_root, "shared", "磁盘更新正文");
    await expect(execute(fixture.tool, { name: "shared" })).resolves.toMatchObject({
      details: { content: expect.stringContaining("磁盘更新正文") },
    });
    fs.unlinkSync(path.join(fixture.builtin_root, "shared", "SKILL.md"));
    await expect(execute(fixture.tool, { name: "shared" })).rejects.toMatchObject({
      details: { code: "skill.resource_not_found" },
    });
  });

  it("集合替换后按新名称和来源读取技能", async () => {
    using fixture = create_fixture("builtin", "shared", "旧正文");
    const filePath = write_skill(fixture.user_root, "new-skill", "用户新正文");
    await expect(execute(fixture.tool, { name: "new-skill" })).rejects.toMatchObject({
      details: { code: "skill.resource_not_found" },
    });
    fixture.catalog.skills = [{ ...fixture.catalog.skills[0]!, name: "new-skill", filePath }];
    await expect(execute(fixture.tool, { name: "new-skill" })).resolves.toMatchObject({
      details: {
        content: expect.stringContaining("用户新正文"),
        base_url: pathToFileURL(path.join(fixture.user_root, "new-skill") + path.sep).href,
      },
    });
    await expect(execute(fixture.tool, { name: "shared" })).rejects.toMatchObject({
      details: { code: "skill.resource_not_found" },
    });
  });

  it.each([
    "../secret.md",
    "nested/../../secret.md",
    "nested\\secret.md",
    "C:/secret.md",
    "/secret.md",
  ])("拒绝绝对路径、反斜线和非规范包内路径：%s", async (requested_path) => {
    using fixture = create_fixture("user", "shared", "正文");

    await expect(
      execute(fixture.tool, { name: "shared", path: requested_path }),
    ).rejects.toMatchObject({
      details: {
        code: "skill.resource_path_invalid",
        name: "shared",
        path: requested_path,
      },
    });
  });

  it("未知 skill 与缺失包内文件返回稳定错误", async () => {
    using fixture = create_fixture("user", "shared", "正文");

    await expect(execute(fixture.tool, { name: "unknown" })).rejects.toMatchObject({
      details: { code: "skill.resource_not_found", name: "unknown", path: "SKILL.md" },
    });
    await expect(
      execute(fixture.tool, { name: "shared", path: "missing.md" }),
    ).rejects.toMatchObject({
      details: { code: "skill.resource_not_found", name: "shared", path: "missing.md" },
    });
  });
});

/** 构建可回收的用户／内置资源根及工具快照，从真实磁盘读取。 */
function create_fixture(source: "user" | "builtin", name: string, body: string) {
  const disposable = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-skill-read-"));
  const user_root = path.join(disposable.path, "user");
  const builtin_root = path.join(disposable.path, "builtin");
  fs.mkdirSync(user_root, { recursive: true });
  fs.mkdirSync(builtin_root, { recursive: true });
  const skill_path = write_skill(source === "user" ? user_root : builtin_root, name, body);
  const catalog: { skills: readonly AgentSkillDefinition[] } = {
    // 模拟服务用新集合替换旧集合。
    skills: [
      {
        name,
        description: `${name} 描述`,
        filePath: skill_path.replaceAll("\\", "/"),
        visible: true,
        displayDescriptions: {
          "zh-CN": `${name} 描述`,
          "en-US": `${name} 描述`,
          "de-DE": `${name} 描述`,
          "ja-JP": `${name} 描述`,
          "ko-KR": `${name} 描述`,
          "pt-BR": `${name} 描述`,
        },
        disableModelInvocation: false,
      },
    ],
  };
  const tool = create_agent_read_skill_tool(() => catalog.skills);
  return {
    [Symbol.dispose]: () => disposable[Symbol.dispose](),
    user_root,
    builtin_root,
    tool,
    catalog,
  };
}

/** 生成带最小合法元数据的技能文件并返回工具使用的路径。 */
function write_skill(root: string, name: string, body: string): string {
  const file_path = path.join(root, name, "SKILL.md");
  write_file(file_path, `---\nname: ${name}\ndescription: ${name} 描述\n---\n\n${body}`);
  return file_path;
}

/** 写入嵌套资源夹具，供包内相对路径场景使用。 */
function write_file(file_path: string, content: string): void {
  fs.mkdirSync(path.dirname(file_path), { recursive: true });
  fs.writeFileSync(file_path, content, "utf8");
}

/** 通过工具公开入口执行查询；此工具不消费会话上下文。 */
async function execute(
  tool: ReturnType<typeof create_agent_read_skill_tool>,
  input: { name: string; path?: string },
) {
  return await tool.execute(input, ...agent_tool_call("read"));
}
