import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import type { TextQualitySnapshot } from "../../../shared/text/text-types";
import { PromptBuilder } from "./prompt-builder";

describe("PromptBuilder", () => {
  it("从资源模板生成翻译提示词并注入上文、术语和控制字符示例", async () => {
    const app_root = await create_template_root();
    const builder = new PromptBuilder(
      app_root,
      {
        app_language: "ZH",
        source_language: "JA",
        target_language: "ZH",
      },
      create_quality_snapshot({
        glossary_entries: [{ src: "Alice", dst: "爱丽丝", info: "女性人名" }],
      }),
    );

    const result = await builder.generate_prompt(["Alice\\n[1]"], ["\\n[1]"], [{ src: "上一句" }]);

    expect(result.messages[0]?.content).toContain("日语");
    expect(result.messages[0]?.content).toContain("简体中文");
    expect(result.messages[1]?.content).toContain("参考上文");
    expect(result.messages[1]?.content).toContain("Alice -> 爱丽丝 #女性人名");
    expect(result.messages[1]?.content).toContain("控制字符示例");
    expect(result.messages[1]?.content).toContain('{"0":"Alice\\\\n[1]"}');
  });

  it("生成术语分析提示词时只携带分析输入", async () => {
    const app_root = await create_template_root();
    const builder = new PromptBuilder(app_root, { app_language: "EN" }, create_quality_snapshot());

    const result = await builder.generate_glossary_prompt(["Alice"]);

    expect(result.messages[0]?.content).toContain("Simplified Chinese");
    expect(result.messages[1]?.content).toBe("Input:\nAlice");
  });
});

/**
 * 构造包含中英文提示词模板的临时 appRoot，避免测试依赖真实资源目录
 */
async function create_template_root(): Promise<string> {
  const app_root = await mkdtemp(path.join(tmpdir(), "linguagacha-prompt-"));
  await write_template(app_root, "translation_prompt", "zh", {
    prefix: "翻译前缀",
    base: "请从 {source_language} 翻译到 {target_language}，保留控制字符。",
    thinking: "思考过程",
    suffix: "输出 JSONLINE",
  });
  await write_template(app_root, "analysis_prompt", "en", {
    prefix: "Analysis prefix",
    base: "Extract terms for {target_language}.",
    thinking: "",
    suffix: "Return JSONLINE",
  });
  await write_template(app_root, "translation_prompt", "en", {
    prefix: "Translation prefix",
    base: "Translate from {source_language} to {target_language}.",
    thinking: "",
    suffix: "Return JSONLINE",
  });
  await write_template(app_root, "analysis_prompt", "zh", {
    prefix: "分析前缀",
    base: "提取 {target_language} 术语。",
    thinking: "",
    suffix: "输出 JSONLINE",
  });
  return app_root;
}

/**
 * 写入单个任务语言模板，保持 PromptBuilder 读取路径与运行态一致
 */
async function write_template(
  app_root: string,
  task_dir_name: string,
  language: "zh" | "en",
  sections: Record<"prefix" | "base" | "thinking" | "suffix", string>,
): Promise<void> {
  const dir = path.join(app_root, "resource", task_dir_name, "template", language);
  await mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(sections)) {
    await writeFile(path.join(dir, `${name}.txt`), content, "utf-8");
  }
}

/**
 * 生成默认关闭高级质量规则的快照，用例只覆盖自己关心的开关
 */
function create_quality_snapshot(
  overrides: Partial<TextQualitySnapshot> = {},
): TextQualitySnapshot {
  return {
    glossary_enable: true,
    glossary_entries: [],
    text_preserve_mode: "OFF",
    text_preserve_entries: [],
    pre_replacement_enable: false,
    pre_replacement_entries: [],
    post_replacement_enable: false,
    post_replacement_entries: [],
    translation_prompt_enable: false,
    translation_prompt: "",
    analysis_prompt_enable: false,
    analysis_prompt: "",
    ...overrides,
  };
}
