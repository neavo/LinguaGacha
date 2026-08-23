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
      content: "执行正文。",
      disableModelInvocation: false,
    },
    {
      name: "manual",
      description: "仅手动调用",
      content: "手动正文。",
      disableModelInvocation: true,
    },
    {
      name: "knowledge",
      description: "UI 隐藏的模型知识",
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
    expect(prompt).not.toContain("<location>");
    expect(prompt).not.toContain("manual");
    expect(prompt).not.toContain("Read the full skill file");
  });

  it("显式调用只包装产品 skill 名称和正文", () => {
    expect(format_agent_skill_invocation(skills[0]!)).toBe(
      '<skill name="visible">\n执行正文。\n</skill>',
    );
  });
});

describe("Agent skill 加载", () => {
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
      },
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

  it("用户有效同名 skill 完整覆盖内置 skill 且不产生诊断", async () => {
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
    write_skill(
      path.join(builtin_dir, "ui.json"),
      '{"order":100,"displayDescriptions":{"en-US":"Built-in skill"}}',
    );
    write_skill(
      path.join(user_dir, "SKILL.md"),
      "---\nname: shared\ndescription: 用户能力\n---\n\n用户正文。",
    );
    write_skill(
      path.join(user_dir, "ui.json"),
      '{"order":200,"displayDescriptions":{"en-US":"User skill"}}',
    );
    const warning = vi.fn();

    await expect(load_agent_skills(paths, { warning, error: vi.fn() })).resolves.toEqual([
      {
        name: "shared",
        description: "用户能力",
        visible: true,
        order: 200,
        displayDescriptions: {
          "zh-CN": "用户能力",
          "en-US": "User skill",
          "de-DE": "用户能力",
        },
        content: "用户正文。",
        filePath: path.join(user_dir, "SKILL.md").replaceAll("\\", "/"),
        disableModelInvocation: false,
      },
    ]);
    expect(warning).not.toHaveBeenCalled();
  });

  it.each([
    ["坏 JSON", "{"],
    ["非法语言", '{"displayDescriptions":{"ja-JP":"日本語"}}'],
    ["非法可见性", '{"visible":"false"}'],
    ["非法顺序类型", '{"order":"100"}'],
    ["负数顺序", '{"order":-1}'],
    ["小数顺序", '{"order":1.5}'],
    ["未知字段", '{"enabled":true}'],
  ])("%s 的 ui.json 整份回退并记录诊断", async (_case_name, ui) => {
    using temp_root = fs.mkdtempDisposableSync(
      path.join(os.tmpdir(), "linguagacha-agent-skills-ui-"),
    );
    const app_root = temp_root.path;
    const paths = new AppPathService({ appRoot: app_root, env: {}, platform: "win32" });
    const skill_dir = path.join(paths.get_agent_builtin_skill_dir(), "invalid-ui");
    write_skill(
      path.join(skill_dir, "SKILL.md"),
      "---\nname: invalid-ui\ndescription: 默认描述\n---\n\n执行任务。",
    );
    write_skill(path.join(skill_dir, "ui.json"), ui);
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
          skill: "invalid-ui",
          path: expect.stringMatching(/ui\.json$/u),
          error: expect.any(String),
        }),
      }),
    );
  });

  it("仅含 visible=false 的 ui.json 隐藏用户能力但保留完整 skill", async () => {
    using temp_root = fs.mkdtempDisposableSync(
      path.join(os.tmpdir(), "linguagacha-agent-skills-hidden-"),
    );
    const paths = new AppPathService({ appRoot: temp_root.path, env: {}, platform: "win32" });
    const skill_dir = path.join(paths.get_agent_builtin_skill_dir(), "hidden");
    write_skill(
      path.join(skill_dir, "SKILL.md"),
      "---\nname: hidden\ndescription: 内部能力\n---\n\n执行内部任务。",
    );
    write_skill(path.join(skill_dir, "ui.json"), '{"visible":false}');
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
});

function write_skill(file_path: string, content: string): void {
  fs.mkdirSync(path.dirname(file_path), { recursive: true });
  fs.writeFileSync(file_path, content, "utf8");
}
