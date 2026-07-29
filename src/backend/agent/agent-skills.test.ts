import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { NativeFs } from "../../native/native-fs";
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
    const warning = vi.fn();
    const log_manager = { warning, error: vi.fn() };
    const native_fs = new NativeFs();
    const read_dirents = vi.spyOn(native_fs, "read_dirents");
    const read_text_file = vi.spyOn(native_fs, "read_text_file");

    await expect(load_agent_skills(paths, log_manager, native_fs)).resolves.toEqual([
      {
        name: "valid",
        description: "合法能力",
        essentials: "执行合法任务。",
        reference_index: "",
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
    expect(read_dirents).toHaveBeenCalled();
    expect(read_text_file).toHaveBeenCalled();
  });

  it("加载带 references 的技能，只在索引中暴露排序后的摘要", async () => {
    const app_root = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-agent-skills-ref-"));
    cleanup_roots.push(app_root);
    const paths = new AppPathService({ appRoot: app_root, env: {}, platform: "win32" });
    const skill_dir = path.join(paths.get_agent_builtin_skill_dir(), "glossary-audit");
    write_skill(
      path.join(skill_dir, "SKILL.md"),
      "---\nname: glossary-audit\ndescription: 审校术语\n---\n\n执行术语审校。",
    );
    write_skill(path.join(skill_dir, "references", "b-standard.md"), "# 标准\n\n第二份正文。");
    write_skill(path.join(skill_dir, "references", "a-first.md"), "# 第一份\n\n首份正文。");
    write_skill(path.join(skill_dir, "references", "ignore.txt"), "不应加载");
    const log_manager = { warning: vi.fn(), error: vi.fn() };

    const skills = await load_agent_skills(paths, log_manager);

    expect(skills).toHaveLength(1);
    const skill = skills[0];
    expect(skill?.essentials).toBe("执行术语审校。");
    // reference_index 按文件名排序，含两份 .md 摘要，不含 .txt。
    expect(skill?.reference_index).toContain("a-first.md: 第一份");
    expect(skill?.reference_index).toContain("b-standard.md: 标准");
    expect(skill?.reference_index).not.toContain("ignore.txt");
    expect(skill?.reference_index.indexOf("a-first.md")).toBeLessThan(
      skill?.reference_index.indexOf("b-standard.md") ?? 0,
    );
    expect(skill?.references.map((reference) => reference.file_name)).toEqual([
      "a-first.md",
      "b-standard.md",
    ]);
  });
});

function write_skill(file_path: string, content: string): void {
  fs.mkdirSync(path.dirname(file_path), { recursive: true });
  fs.writeFileSync(file_path, content, "utf8");
}
