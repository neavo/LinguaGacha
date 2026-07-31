import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { AppPathService } from "../app/app-path-service";
import { load_agent_skills } from "./agent-skills";

const cleanup_roots: string[] = [];

afterEach(() => {
  while (cleanup_roots.length > 0) {
    const root = cleanup_roots.pop();
    if (root !== undefined) fs.rmSync(root, { force: true, recursive: true });
  }
});

describe("Agent skill 加载", () => {
  it("加载双目录合法 SKILL.md，记录坏 frontmatter，并过滤目录名不匹配项", async () => {
    const app_root = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-agent-skills-"));
    cleanup_roots.push(app_root);
    const paths = new AppPathService({ appRoot: app_root, env: {}, platform: "win32" });
    write_skill(
      path.join(paths.get_agent_builtin_skill_dir(), "valid", "SKILL.md"),
      "---\nname: valid\ndescription: 合法能力\n---\n\n执行合法任务。",
    );
    write_skill(
      path.join(paths.get_agent_user_skill_dir(), "broken", "SKILL.md"),
      "---\nname: [\n---\n坏内容",
    );
    write_skill(
      path.join(paths.get_agent_user_skill_dir(), "folder-name", "SKILL.md"),
      "---\nname: other-name\ndescription: 名称错位\n---\n\n不应加载。",
    );
    write_skill(
      path.join(paths.get_agent_user_skill_dir(), "manual", "SKILL.md"),
      "---\nname: manual\ndescription: 手动能力\ndisable-model-invocation: true\n---\n\n执行手动任务。",
    );
    const warning = vi.fn();
    const log_manager = { warning, error: vi.fn() };

    await expect(load_agent_skills(paths, log_manager)).resolves.toEqual([
      {
        name: "valid",
        description: "合法能力",
        content: "执行合法任务。",
        filePath: expect.stringMatching(/\/valid\/SKILL\.md$/u),
        disableModelInvocation: false,
        references: [],
      },
      {
        name: "manual",
        description: "手动能力",
        content: "执行手动任务。",
        filePath: expect.stringMatching(/\/manual\/SKILL\.md$/u),
        disableModelInvocation: true,
        references: [],
      },
    ]);
    expect(warning).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ source: "agent" }),
    );
    expect(warning.mock.calls.map((call) => call[1]?.context?.code)).toEqual(
      expect.arrayContaining(["parse_failed", "invalid_metadata"]),
    );
  });

  it("用户同名 skill 连同正文、路径与 references 一起覆盖内置定义", async () => {
    const app_root = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-agent-skills-override-"));
    cleanup_roots.push(app_root);
    const paths = new AppPathService({ appRoot: app_root, env: {}, platform: "win32" });
    const builtin_dir = path.join(paths.get_agent_builtin_skill_dir(), "shared");
    const user_dir = path.join(paths.get_agent_user_skill_dir(), "shared");
    write_skill(
      path.join(builtin_dir, "SKILL.md"),
      "---\nname: shared\ndescription: 内置能力\n---\n\n内置正文。",
    );
    write_skill(path.join(builtin_dir, "references", "guide.md"), "# 内置参考");
    write_skill(
      path.join(user_dir, "SKILL.md"),
      "---\nname: shared\ndescription: 用户能力\n---\n\n用户正文。",
    );
    write_skill(path.join(user_dir, "references", "guide.md"), "# 用户参考");

    await expect(load_agent_skills(paths, { warning: vi.fn(), error: vi.fn() })).resolves.toEqual([
      {
        name: "shared",
        description: "用户能力",
        content: "用户正文。",
        filePath: path.join(user_dir, "SKILL.md").replaceAll("\\", "/"),
        disableModelInvocation: false,
        references: [
          {
            path: "references/guide.md",
            filePath: path.join(user_dir, "references", "guide.md").replaceAll("\\", "/"),
            content: "# 用户参考",
          },
        ],
      },
    ]);
  });

  it("递归加载排序后的 Markdown references，并忽略其它文件和符号链接", async () => {
    const app_root = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-agent-skills-ref-"));
    cleanup_roots.push(app_root);
    const paths = new AppPathService({ appRoot: app_root, env: {}, platform: "win32" });
    const skill_dir = path.join(paths.get_agent_builtin_skill_dir(), "glossary-audit");
    write_skill(
      path.join(skill_dir, "SKILL.md"),
      "---\nname: glossary-audit\ndescription: 审校术语\n---\n\n执行术语审校。",
    );
    write_skill(
      path.join(skill_dir, "references", "nested", "b-standard.md"),
      "# 标准\n\n第二份正文。",
    );
    write_skill(path.join(skill_dir, "references", "a-first.md"), "# 第一份\n\n首份正文。");
    write_skill(path.join(skill_dir, "references", "ignore.txt"), "不应加载");
    const linked_dir = path.join(app_root, "linked-references");
    write_skill(path.join(linked_dir, "secret.md"), "不应跟随符号链接");
    fs.symlinkSync(linked_dir, path.join(skill_dir, "references", "linked"), "junction");
    const log_manager = { warning: vi.fn(), error: vi.fn() };

    const skills = await load_agent_skills(paths, log_manager);

    expect(skills).toHaveLength(1);
    const skill = skills[0];
    expect(skill?.content).toBe("执行术语审校。");
    expect(skill?.references).toEqual([
      {
        path: "references/a-first.md",
        filePath: expect.stringMatching(/\/references\/a-first\.md$/u),
        content: "# 第一份\n\n首份正文。",
      },
      {
        path: "references/nested/b-standard.md",
        filePath: expect.stringMatching(/\/references\/nested\/b-standard\.md$/u),
        content: "# 标准\n\n第二份正文。",
      },
    ]);
  });
});

function write_skill(file_path: string, content: string): void {
  fs.mkdirSync(path.dirname(file_path), { recursive: true });
  fs.writeFileSync(file_path, content, "utf8");
}
