import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { AgentSkillDefinition } from "./agent-skills";
import { create_agent_skill_tools } from "./agent-skill-tools";

describe("Agent 技能读取工具", () => {
  it("按名称读取会话 skill 的默认正文和包内相对文件", async () => {
    using fixture = create_fixture("builtin", "shared", "内置正文");
    write_file(path.join(fixture.builtin_root, "shared", "references", "guide.md"), "参考正文");

    await expect(execute(fixture.tool, { name: "shared" })).resolves.toMatchObject({
      details: { name: "shared", path: "SKILL.md", content: expect.stringContaining("内置正文") },
    });
    await expect(
      execute(fixture.tool, { name: "shared", path: "references/guide.md" }),
    ).resolves.toMatchObject({
      details: { name: "shared", path: "references/guide.md", content: "参考正文" },
    });
  });

  it("当前会话名称始终绑定已冻结的获胜 skill 包", async () => {
    using fixture = create_fixture("builtin", "shared", "会话内置正文");
    write_skill(fixture.user_root, "shared", "后来新增的用户正文");

    await expect(execute(fixture.tool, { name: "shared" })).resolves.toMatchObject({
      details: { content: expect.stringContaining("会话内置正文") },
    });
  });

  it("实时发现 catalog 外的新名称，并沿用用户有效定义优先级", async () => {
    using fixture = create_fixture();
    write_skill(fixture.builtin_root, "new-skill", "内置新正文");
    write_skill(fixture.user_root, "new-skill", "用户新正文");

    await expect(execute(fixture.tool, { name: "new-skill" })).resolves.toMatchObject({
      details: {
        name: "new-skill",
        path: "SKILL.md",
        content: expect.stringContaining("用户新正文"),
      },
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
        code: "skill.resource_not_allowed",
        name: "shared",
        path: requested_path,
      },
    });
  });

  it("拒绝通过 skill 包内符号链接读取包外文件", async () => {
    using fixture = create_fixture("user", "shared", "正文");
    const outside = path.join(fixture.root, "outside");
    write_file(path.join(outside, "secret.md"), "不可读取");
    fs.symlinkSync(outside, path.join(fixture.user_root, "shared", "linked"), "junction");

    await expect(
      execute(fixture.tool, { name: "shared", path: "linked/secret.md" }),
    ).rejects.toMatchObject({
      details: {
        code: "skill.resource_not_allowed",
        name: "shared",
        path: "linked/secret.md",
      },
    });
  });

  it("拒绝会话建立后被整体替换到全局 skill 根外的包", async () => {
    using fixture = create_fixture("user", "shared", "正文");
    const outside = path.join(fixture.root, "outside-package");
    write_skill(fixture.root, "outside-package", "根外正文");
    fs.rmSync(path.join(fixture.user_root, "shared"), { recursive: true });
    fs.symlinkSync(outside, path.join(fixture.user_root, "shared"), "junction");

    await expect(execute(fixture.tool, { name: "shared" })).rejects.toMatchObject({
      details: {
        code: "skill.resource_not_allowed",
        name: "shared",
        path: "SKILL.md",
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

function create_fixture(source?: "user" | "builtin", name = "shared", body = "正文") {
  const disposable = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-skill-read-"));
  const user_root = path.join(disposable.path, "user");
  const builtin_root = path.join(disposable.path, "builtin");
  fs.mkdirSync(user_root, { recursive: true });
  fs.mkdirSync(builtin_root, { recursive: true });
  const skill_path =
    source === undefined
      ? null
      : write_skill(source === "user" ? user_root : builtin_root, name, body);
  const skills =
    skill_path === null
      ? []
      : [
          {
            name,
            description: `${name} 描述`,
            filePath: skill_path.replaceAll("\\", "/"),
            content: body,
            visible: true,
            displayDescriptions: {
              "zh-CN": `${name} 描述`,
              "en-US": `${name} 描述`,
              "de-DE": `${name} 描述`,
            },
            disableModelInvocation: false,
          } satisfies AgentSkillDefinition,
        ];
  const [tool] = create_agent_skill_tools(
    skills,
    {
      get_app_root: () => disposable.path,
      get_agent_user_skill_dir: () => user_root,
      get_agent_builtin_skill_dir: () => builtin_root,
    },
    { warning: vi.fn(), error: vi.fn() },
  );
  if (tool === undefined) throw new Error("缺少 read_skill");
  return {
    [Symbol.dispose]: () => disposable[Symbol.dispose](),
    root: disposable.path,
    user_root,
    builtin_root,
    tool,
  };
}

function write_skill(root: string, name: string, body: string): string {
  const file_path = path.join(root, name, "SKILL.md");
  write_file(file_path, `---\nname: ${name}\ndescription: ${name} 描述\n---\n\n${body}`);
  return file_path;
}

function write_file(file_path: string, content: string): void {
  fs.mkdirSync(path.dirname(file_path), { recursive: true });
  fs.writeFileSync(file_path, content, "utf8");
}

async function execute(
  tool: ReturnType<typeof create_agent_skill_tools>[number],
  input: { name: string; path?: string },
) {
  return await tool!.execute("read", input, undefined, undefined, undefined as never);
}
