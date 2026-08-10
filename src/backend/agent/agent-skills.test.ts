import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { AppPathService } from "../app/app-path-service";
import {
  format_agent_skill_invocation,
  format_agent_skills_for_system_prompt,
  load_agent_skills,
} from "./agent-skills";

describe("Agent skill 模型投影", () => {
  const skills = [
    {
      name: "visible",
      description: "使用 <能力> & 规则",
      filePath: "E:/skills/a&b/SKILL.md",
      content: "执行正文。",
      disableModelInvocation: false,
    },
    {
      name: "manual",
      description: "仅手动调用",
      filePath: "E:/skills/manual/SKILL.md",
      content: "手动正文。",
      disableModelInvocation: true,
    },
    {
      name: "knowledge",
      description: "UI 隐藏的模型知识",
      filePath: "E:/skills/knowledge/SKILL.md",
      content: "知识正文。",
      disableModelInvocation: false,
      visible: false,
    },
  ];

  it("系统清单投影全部自动能力且不受 UI 可见性影响", () => {
    const prompt = format_agent_skills_for_system_prompt(skills);

    expect(prompt).toContain("<name>visible</name>");
    expect(prompt).toContain("<name>knowledge</name>");
    expect(prompt).toContain("使用 &lt;能力&gt; &amp; 规则");
    expect(prompt).toContain("E:/skills/a&amp;b/SKILL.md");
    expect(prompt).not.toContain("manual");
    expect(prompt).not.toContain("Read the full skill file");
  });

  it("显式调用只包装产品 skill 正文和位置", () => {
    expect(format_agent_skill_invocation(skills[0]!)).toBe(
      '<skill name="visible" location="E:/skills/a&amp;b/SKILL.md">\n执行正文。\n</skill>',
    );
  });
});

describe("Agent skill 加载", () => {
  it("内置 skill 资源可直接加载且不产生诊断", async () => {
    using temp_root = fs.mkdtempDisposableSync(
      path.join(os.tmpdir(), "linguagacha-agent-builtin-skills-"),
    );
    const warning = vi.fn();
    const error = vi.fn();

    const skills = await load_agent_skills(
      {
        get_app_root: () => process.cwd(),
        get_agent_builtin_skill_dir: () => path.join(process.cwd(), "resource", "agent", "skill"),
        get_agent_user_skill_dir: () => path.join(temp_root.path, "user-skill"),
      },
      { warning, error },
    );

    expect(skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "adult-fiction-writing", visible: false }),
        expect.objectContaining({ name: "glossary-create", visible: true }),
        expect.objectContaining({ name: "glossary-review", visible: true }),
        expect.objectContaining({
          name: "glossary-rules",
          visible: false,
          disableModelInvocation: false,
        }),
      ]),
    );
    expect(warning).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("加载双目录合法 SKILL.md，记录坏 frontmatter，并过滤目录名不匹配项", async () => {
    using temp_root = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-agent-skills-"));
    const app_root = temp_root.path;
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
        visible: true,
        displayDescriptions: {
          "zh-CN": "合法能力",
          "en-US": "合法能力",
          "de-DE": "合法能力",
        },
        content: "执行合法任务。",
        filePath: expect.stringMatching(/\/valid\/SKILL\.md$/u),
        disableModelInvocation: false,
        references: [],
      },
      {
        name: "manual",
        description: "手动能力",
        visible: true,
        displayDescriptions: {
          "zh-CN": "手动能力",
          "en-US": "手动能力",
          "de-DE": "手动能力",
        },
        content: "执行手动任务。",
        filePath: expect.stringMatching(/\/manual\/SKILL\.md$/u),
        disableModelInvocation: true,
        references: [],
      },
    ]);
    expect(warning).toHaveBeenCalledWith(
      "Agent skill 资源加载失败 …",
      expect.objectContaining({
        source: "agent",
        context: expect.objectContaining({ diagnostic_message: expect.any(String) }),
      }),
    );
    expect(warning.mock.calls.map((call) => call[1]?.context?.code)).toEqual(
      expect.arrayContaining(["parse_failed", "invalid_metadata"]),
    );
  });

  it("用户同名 skill 连同正文、路径与 references 一起覆盖内置定义", async () => {
    using temp_root = fs.mkdtempDisposableSync(
      path.join(os.tmpdir(), "linguagacha-agent-skills-override-"),
    );
    const app_root = temp_root.path;
    const paths = new AppPathService({ appRoot: app_root, env: {}, platform: "win32" });
    const builtin_dir = path.join(paths.get_agent_builtin_skill_dir(), "shared");
    const user_dir = path.join(paths.get_agent_user_skill_dir(), "shared");
    write_skill(
      path.join(builtin_dir, "SKILL.md"),
      "---\nname: shared\ndescription: 内置能力\n---\n\n内置正文。",
    );
    write_skill(path.join(builtin_dir, "i18n.json"), '{"en-US":"Built-in skill"}');
    write_skill(path.join(builtin_dir, "references", "guide.md"), "# 内置参考");
    write_skill(
      path.join(user_dir, "SKILL.md"),
      "---\nname: shared\ndescription: 用户能力\n---\n\n用户正文。",
    );
    write_skill(path.join(user_dir, "i18n.json"), '{"en-US":"User skill"}');
    write_skill(path.join(user_dir, "references", "guide.md"), "# 用户参考");

    await expect(load_agent_skills(paths, { warning: vi.fn(), error: vi.fn() })).resolves.toEqual([
      {
        name: "shared",
        description: "用户能力",
        visible: true,
        displayDescriptions: {
          "zh-CN": "用户能力",
          "en-US": "User skill",
          "de-DE": "用户能力",
        },
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

  it.each([
    ["坏 JSON", "{"],
    ["非法语言", '{"ja-JP":"日本語"}'],
    ["非法可见性", '{"visible":"false"}'],
  ])("%s 的 i18n.json 整份回退并记录诊断", async (_case_name, i18n) => {
    using temp_root = fs.mkdtempDisposableSync(
      path.join(os.tmpdir(), "linguagacha-agent-skills-i18n-"),
    );
    const app_root = temp_root.path;
    const paths = new AppPathService({ appRoot: app_root, env: {}, platform: "win32" });
    const skill_dir = path.join(paths.get_agent_builtin_skill_dir(), "invalid-i18n");
    write_skill(
      path.join(skill_dir, "SKILL.md"),
      "---\nname: invalid-i18n\ndescription: 默认描述\n---\n\n执行任务。",
    );
    write_skill(path.join(skill_dir, "i18n.json"), i18n);
    const warning = vi.fn();

    const skills = await load_agent_skills(paths, { warning, error: vi.fn() });

    expect(skills[0]).toMatchObject({
      visible: true,
      displayDescriptions: {
        "zh-CN": "默认描述",
        "en-US": "默认描述",
        "de-DE": "默认描述",
      },
    });
    expect(warning).toHaveBeenCalledWith(
      "Agent skill 资源加载失败 …",
      expect.objectContaining({
        source: "agent",
        context: expect.objectContaining({
          skill: "invalid-i18n",
          path: expect.stringMatching(/i18n\.json$/u),
          error: expect.any(String),
        }),
      }),
    );
  });

  it("仅含 visible=false 的 i18n.json 隐藏 UI 能力但保留完整 skill", async () => {
    using temp_root = fs.mkdtempDisposableSync(
      path.join(os.tmpdir(), "linguagacha-agent-skills-hidden-"),
    );
    const paths = new AppPathService({ appRoot: temp_root.path, env: {}, platform: "win32" });
    const skill_dir = path.join(paths.get_agent_builtin_skill_dir(), "hidden");
    write_skill(
      path.join(skill_dir, "SKILL.md"),
      "---\nname: hidden\ndescription: 内部能力\n---\n\n执行内部任务。",
    );
    write_skill(path.join(skill_dir, "i18n.json"), '{"visible":false}');
    const warning = vi.fn();

    const skills = await load_agent_skills(paths, { warning, error: vi.fn() });

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      name: "hidden",
      description: "内部能力",
      content: "执行内部任务。",
      visible: false,
      displayDescriptions: {
        "zh-CN": "内部能力",
        "en-US": "内部能力",
        "de-DE": "内部能力",
      },
    });
    expect(warning).not.toHaveBeenCalled();
  });

  it("递归加载排序后的 references，并忽略符号链接", async () => {
    using temp_root = fs.mkdtempDisposableSync(
      path.join(os.tmpdir(), "linguagacha-agent-skills-ref-"),
    );
    const app_root = temp_root.path;
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
    write_skill(path.join(skill_dir, "references", "rules.json"), '{"strict":true}');
    const linked_dir = path.join(app_root, "linked-references");
    write_skill(path.join(linked_dir, "secret.md"), "不应跟随符号链接");
    fs.symlinkSync(linked_dir, path.join(skill_dir, "references", "linked"), "junction");
    const log_manager = { warning: vi.fn(), error: vi.fn() };

    const skills = await load_agent_skills(paths, log_manager);

    expect(skills).toHaveLength(1);
    const skill = skills[0];
    expect(skill?.content).toBe("执行术语审校。");
    expect(skill).toMatchObject({
      visible: true,
      displayDescriptions: {
        "zh-CN": "审校术语",
        "en-US": "审校术语",
        "de-DE": "审校术语",
      },
    });
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
      {
        path: "references/rules.json",
        filePath: expect.stringMatching(/\/references\/rules\.json$/u),
        content: '{"strict":true}',
      },
    ]);
  });
});

function write_skill(file_path: string, content: string): void {
  fs.mkdirSync(path.dirname(file_path), { recursive: true });
  fs.writeFileSync(file_path, content, "utf8");
}
