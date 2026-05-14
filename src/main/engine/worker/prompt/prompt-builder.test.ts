import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import type { TextQualitySnapshot } from "../../../../shared/text/text-types";
import { PromptBuilder } from "./prompt-builder";

describe("PromptBuilder", () => {
  afterEach(() => {
    PromptBuilder.reset();
  });

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

    expect(result.messages[0]?.content).toContain("日文");
    expect(result.messages[0]?.content).toContain("中文");
    expect(result.messages[1]?.content).toContain("参考上文");
    expect(result.messages[1]?.content).toContain("Alice -> 爱丽丝 #女性人名");
    expect(result.messages[1]?.content).toContain("控制字符示例");
    expect(result.messages[1]?.content).toContain('{"0":"Alice\\\\n[1]"}');
  });

  it("生成术语分析提示词时只携带分析输入", async () => {
    const app_root = await create_template_root();
    const builder = new PromptBuilder(app_root, { app_language: "EN" }, create_quality_snapshot());

    const result = await builder.generate_glossary_prompt(["Alice"]);

    expect(result.messages[0]?.content).toContain("Chinese");
    expect(result.messages[1]?.content).toBe("Input:\nAlice");
  });

  it("源语言为 ALL 时使用提示词语言的源语言占位文本", async () => {
    const app_root = await create_template_root();
    const builder = new PromptBuilder(
      app_root,
      {
        app_language: "ZH",
        source_language: "ALL",
        target_language: "ZH",
      },
      create_quality_snapshot(),
    );

    const result = await builder.build_main();

    expect(result).toContain("请从 原文 翻译到 中文");
    expect(result).not.toContain("{source_language}");
    expect(result).not.toContain("{target_language}");
  });

  it("目标语言为 ALL 时拒绝构造提示词", async () => {
    const app_root = await create_template_root();
    const builder = new PromptBuilder(
      app_root,
      {
        app_language: "ZH",
        source_language: "JA",
        target_language: "ALL",
      },
      create_quality_snapshot(),
    );

    await expect(builder.build_main()).rejects.toThrow("target_language");
  });

  it("目标语言无效时拒绝构造提示词", async () => {
    const app_root = await create_template_root();
    const builder = new PromptBuilder(
      app_root,
      {
        app_language: "ZH",
        source_language: "JA",
        target_language: "INVALID",
      },
      create_quality_snapshot(),
    );

    await expect(builder.build_main()).rejects.toThrow("invalid target_language");
  });

  it("提示词模板语言跟随 UI 语言而不是目标语言", async () => {
    const app_root = await create_template_root();
    const builder = new PromptBuilder(
      app_root,
      {
        app_language: "EN",
        source_language: "JA",
        target_language: "ZH",
      },
      create_quality_snapshot(),
    );

    const result = await builder.build_main();

    expect(result).toContain("Translation prefix");
    expect(result).toContain("Translate from Japanese to Chinese.");
  });

  it("英文提示词中匈牙利文使用正确 Hungarian 拼写", async () => {
    const app_root = await create_template_root();
    const builder = new PromptBuilder(
      app_root,
      {
        app_language: "EN",
        source_language: "HU",
        target_language: "ZH",
      },
      create_quality_snapshot(),
    );

    const result = await builder.build_main();

    expect(result).toContain("Translate from Hungarian to Chinese.");
    expect(result).not.toContain("Hungrarian");
  });

  it("中文提示词中西班牙文复用共享语言名称", async () => {
    const app_root = await create_template_root();
    const builder = new PromptBuilder(
      app_root,
      {
        app_language: "ZH",
        source_language: "ES",
        target_language: "ZH",
      },
      create_quality_snapshot(),
    );

    const result = await builder.build_main();

    expect(result).toContain("请从 西班牙文 翻译到 中文");
    expect(result).not.toContain("请从 西班牙 翻译到 中文");
  });

  it("源语言无效时回退为提示词语言的源文本占位", async () => {
    const app_root = await create_template_root();
    const builder = new PromptBuilder(
      app_root,
      {
        app_language: "EN",
        source_language: "INVALID",
        target_language: "ZH",
      },
      create_quality_snapshot(),
    );

    const result = await builder.build_main();

    expect(result).toContain("Translate from Source to Chinese.");
  });

  it("启用自定义翻译提示词时仍拼接前后缀和 thinking 段", async () => {
    const app_root = await create_template_root();
    const builder = new PromptBuilder(
      app_root,
      {
        app_language: "ZH",
        source_language: "JA",
        target_language: "ZH",
      },
      create_quality_snapshot({
        translation_prompt_enable: true,
        translation_prompt: "自定义规则：{target_language}",
      }),
    );

    const result = await builder.build_main();

    expect(result).toBe("翻译前缀\n自定义规则：中文\n\n思考过程\n\n输出 JSONLINE");
  });

  it("术语表匹配时尊重大小写标志并格式化 info 字段", () => {
    const builder = new PromptBuilder(
      "unused",
      { app_language: "EN", target_language: "EN" },
      create_quality_snapshot({
        glossary_entries: [
          { src: "ABC", dst: "甲", case_sensitive: true },
          { src: "foo", dst: "乙", info: "备注", case_sensitive: false },
        ],
      }),
    );

    const result = builder.build_glossary(["abc foo"]);

    expect(result).toContain("Glossary");
    expect(result).toContain("foo -> 乙 #备注");
    expect(result).not.toContain("ABC -> 甲");
  });

  it("控制字符示例只在 system 指令明确要求时加入并去重", () => {
    const builder = new PromptBuilder("unused", { app_language: "ZH" }, create_quality_snapshot());

    expect(builder.build_control_characters_samples("普通内容", ["<a>"])).toBe("");
    expect(
      builder.build_control_characters_samples("控制符必须原样保留", ["<a>", "<b>", "<a>", ""]),
    ).toBe("控制字符示例：\n<a>, <b>");
  });

  it("参考上文为空时返回空字符串，非空时按 UI 语言格式化", () => {
    const zh_builder = new PromptBuilder(
      "unused",
      { app_language: "ZH" },
      create_quality_snapshot(),
    );
    const en_builder = new PromptBuilder(
      "unused",
      { app_language: "EN" },
      create_quality_snapshot(),
    );

    expect(zh_builder.build_preceding([])).toBe("");
    expect(zh_builder.build_preceding([{ src: "line1\nline2" }])).toBe("参考上文：\nline1\\nline2");
    expect(en_builder.build_preceding([{ src: "line3" }])).toBe("Preceding Context:\nline3");
  });

  it("Sakura 提示词在术语启用但未命中时使用默认内容", () => {
    const builder = new PromptBuilder(
      "unused",
      { app_language: "ZH", target_language: "ZH" },
      create_quality_snapshot({
        glossary_enable: true,
        glossary_entries: [{ src: "HP", dst: "生命值", case_sensitive: true }],
      }),
    );

    const result = builder.generate_prompt_sakura(["hp が足りない"]);

    expect(result.messages[1]?.content).toBe("将下面的日文文本翻译成中文：\nhp が足りない");
    expect(result.console_log).toEqual([]);
  });

  it("Sakura 术语表命中时使用无空格箭头格式", () => {
    const builder = new PromptBuilder(
      "unused",
      { app_language: "ZH", target_language: "ZH" },
      create_quality_snapshot({
        glossary_enable: true,
        glossary_entries: [{ src: "HP", dst: "生命值", case_sensitive: true, info: "stat" }],
      }),
    );

    const result = builder.generate_prompt_sakura(["hp", "HP"]);

    expect(result.console_log).toEqual(["HP->生命值 #stat"]);
    expect(result.messages[1]?.content).toContain("根据以下术语表");
  });

  it("生成普通提示词时术语关闭则不写入 user prompt", async () => {
    const app_root = await create_template_root();
    const builder = new PromptBuilder(
      app_root,
      { app_language: "ZH", source_language: "JA", target_language: "ZH" },
      create_quality_snapshot({
        glossary_enable: false,
        glossary_entries: [{ src: "HP", dst: "生命值", case_sensitive: false }],
      }),
    );

    const result = await builder.generate_prompt(["HP is low"], [], []);

    expect(result.messages[1]?.content).not.toContain("术语表");
    expect(result.messages[1]?.content).toContain("输入：");
    expect(result.console_log).toEqual([]);
  });

  it("分析主提示词启用自定义正文时读取分析模板目录", async () => {
    const app_root = await create_template_root();
    const builder = new PromptBuilder(
      app_root,
      { app_language: "ZH", target_language: "ZH" },
      create_quality_snapshot({
        analysis_prompt_enable: true,
        analysis_prompt: "自定义分析：{target_language}",
      }),
    );

    const result = await builder.build_glossary_analysis_main();

    expect(result).toBe("分析前缀\n自定义分析：中文\n\n输出 JSONLINE");
    expect(result).not.toContain("翻译前缀");
  });

  it("模板读取结果会缓存并可通过 reset 重新读取", async () => {
    const app_root = await create_template_root();
    const builder = new PromptBuilder(
      app_root,
      { app_language: "ZH", source_language: "JA", target_language: "ZH" },
      create_quality_snapshot(),
    );

    expect(await builder.build_main()).toContain("保留控制字符");

    await write_template(app_root, "translation_prompt", "zh", {
      prefix: "翻译前缀2",
      base: "新规则 {target_language}",
      thinking: "",
      suffix: "输出2",
    });

    expect(await builder.build_main()).toContain("保留控制字符");
    PromptBuilder.reset();
    expect(await builder.build_main()).toContain("新规则 中文");
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
