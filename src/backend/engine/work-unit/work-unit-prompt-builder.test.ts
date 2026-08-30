import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import type { TextQualitySnapshot } from "../../../shared/text/text-types";
import type { TranslationActor, TranslationRequestItem } from "./translation-item";
import { PromptBuilder } from "./work-unit-prompt-builder";

const template_roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    template_roots.splice(0).map(async (root) => {
      await rm(root, { force: true, recursive: true });
    }),
  );
});

describe("PromptBuilder", () => {
  it("每个 item 只生成一条 JSONL，text 内换行由 JSON 转义承载", async () => {
    const builder = new PromptBuilder(
      await create_template_root(),
      { app_language: "ZH", source_language: "JA", target_language: "ZH" },
      create_quality_snapshot(),
      [],
    );
    const result = await builder.generate_prompt(
      [{ request_index: 3, item_index: 0, text_src: "甲\n乙", actor_src: null }],
      "text",
      [],
      [],
    );
    const input = result.messages[1]?.content ?? "";
    expect(input).toContain('{"index":3,"text":"甲\\n乙"}');
    expect(input.match(/\{"index":/gu)).toHaveLength(1);
  });

  it("从资源模板生成翻译提示词并注入上文、术语和控制字符示例", async () => {
    const builtin_root = await create_template_root();
    const builder = new PromptBuilder(
      builtin_root,
      {
        app_language: "ZH",
        source_language: "JA",
        target_language: "ZH",
      },
      create_quality_snapshot({
        glossary_entries: [{ src: "Alice", dst: "爱丽丝", info: "女性人名" }],
      }),
      [
        {
          entry_id: "alice",
          src: "Alice",
          dst: "爱丽丝",
          info: "女性人名",
          case_sensitive: false,
        },
      ],
    );

    const result = await builder.generate_prompt(
      [create_line({ text_src: "Alice\\n[1]" })],
      "text",
      ["\\n[1]", "<b>", "\\n[1]", ""],
      [{ src: "上一句" }],
    );

    expect(result.messages[0]?.content).toContain("日文");
    expect(result.messages[0]?.content).toContain("中文");
    expect(result.messages[1]?.content).toContain("参考上文");
    expect(result.messages[1]?.content).toContain("Alice -> 爱丽丝 #女性人名");
    expect(result.messages[1]?.content).toContain("控制字符示例：\n\\n[1], <b>");
    expect(result.messages[1]?.content).toContain('{"index":0,"text":"Alice\\\\n[1]"}');
  });

  it("生成术语分析提示词时只携带分析输入", async () => {
    const builtin_root = await create_template_root();
    const builder = new PromptBuilder(
      builtin_root,
      { app_language: "EN" },
      create_quality_snapshot(),
      [],
    );

    const result = await builder.generate_glossary_prompt(["Alice"]);

    expect(result.messages[0]?.content).toContain("Chinese");
    expect(result.messages[1]?.content).toContain("Alice");
  });

  it("提示词模板语言跟随 UI 语言而不是目标语言", async () => {
    const builtin_root = await create_template_root();
    const builder = new PromptBuilder(
      builtin_root,
      {
        app_language: "EN",
        source_language: "JA",
        target_language: "ZH",
      },
      create_quality_snapshot(),
      [],
    );

    const result = await builder.build_main("text");

    expect(result).toContain("Translation prefix");
    expect(result).toContain("Translate from Japanese to Chinese.");
  });

  it("启用自定义翻译提示词时仍拼接前后缀和 thinking 段", async () => {
    const builtin_root = await create_template_root();
    const builder = new PromptBuilder(
      builtin_root,
      {
        app_language: "ZH",
        source_language: "JA",
        target_language: "ZH",
      },
      create_quality_snapshot({
        translation_prompt_enable: true,
        translation_prompt: "自定义规则：{target_language}",
      }),
      [],
    );

    const result = await builder.build_main("text");

    expect(result).toContain("翻译前缀");
    expect(result).toContain("自定义规则：中文");
    expect(result).toContain("思考过程");
    expect(result).toContain('{"index":<序号>,"text":"<译文文本>"}');
  });

  it("关闭提示词增强时翻译和分析都只保留前缀、正文与后缀", async () => {
    const builder = new PromptBuilder(
      await create_template_root(),
      {
        app_language: "ZH",
        source_language: "JA",
        target_language: "ZH",
        prompt_enhancement_enable: false,
      },
      create_quality_snapshot(),
      [],
    );

    const translation_prompt = await builder.build_main("text");
    expect(translation_prompt).toContain("翻译前缀");
    expect(translation_prompt).toContain("请从 日文 翻译到 中文，保留控制字符。");
    expect(translation_prompt).toContain('{"index":<序号>,"text":"<译文文本>"}');
    expect(translation_prompt).not.toContain("思考过程");

    const analysis_prompt = await builder.build_glossary_analysis_main();
    expect(analysis_prompt).toContain("分析前缀");
    expect(analysis_prompt).toContain("提取 中文 术语。");
    expect(analysis_prompt).not.toContain("分析思考");
  });

  it("公开提示词只格式化 runner 已激活的术语", async () => {
    const builtin_root = await create_template_root();
    const builder = new PromptBuilder(
      builtin_root,
      { app_language: "EN", target_language: "EN" },
      create_quality_snapshot({
        glossary_entries: [
          { src: "ABC", dst: "甲", case_sensitive: true },
          { src: "foo", dst: "乙", info: "备注", case_sensitive: false },
        ],
      }),
      [{ entry_id: "foo", src: "foo", dst: "乙", info: "备注", case_sensitive: false }],
    );

    const result = await builder.generate_prompt(
      [create_line({ text_src: "abc foo" })],
      "text",
      [],
      [],
    );
    const user_prompt = result.messages[1]?.content ?? "";

    expect(user_prompt).toContain("Glossary");
    expect(user_prompt).toContain("foo -> 乙 #备注");
    expect(user_prompt).not.toContain("ABC -> 甲");
  });

  it("system 指令未要求控制字符时不注入示例", async () => {
    const builder = new PromptBuilder(
      await create_template_root(),
      { app_language: "ZH", source_language: "JA", target_language: "ZH" },
      create_quality_snapshot({
        translation_prompt_enable: true,
        translation_prompt: "普通内容",
      }),
      [],
    );

    const result = await builder.generate_prompt(
      [create_line({ text_src: "正文" })],
      "text",
      ["<a>"],
      [],
    );

    expect(result.messages[1]?.content).not.toContain("控制字符示例");
  });

  it("Sakura 已激活术语使用无空格箭头格式", () => {
    const builder = new PromptBuilder(
      "unused",
      { app_language: "ZH", target_language: "ZH" },
      create_quality_snapshot(),
      [{ entry_id: "hp", src: "HP", dst: "生命值", info: "stat", case_sensitive: true }],
    );

    const result = builder.generate_prompt_sakura("HP");

    expect(result.console_log).toEqual(["HP->生命值 #stat"]);
    expect(result.messages[1]?.content).toContain("根据以下术语表");
  });

  it("普通提示词没有已激活术语时不写入术语段", async () => {
    const builtin_root = await create_template_root();
    const builder = new PromptBuilder(
      builtin_root,
      { app_language: "ZH", source_language: "JA", target_language: "ZH" },
      create_quality_snapshot(),
      [],
    );

    const result = await builder.generate_prompt(
      [create_line({ text_src: "HP is low" })],
      "text",
      [],
      [],
    );

    expect(result.messages[1]?.content).not.toContain("术语表");
    expect(result.messages[1]?.content).toContain("输入：");
    expect(result.console_log).toEqual([]);
  });

  it("分析主提示词启用自定义正文时读取分析模板目录", async () => {
    const builtin_root = await create_template_root();
    const builder = new PromptBuilder(
      builtin_root,
      { app_language: "ZH", target_language: "ZH" },
      create_quality_snapshot({
        analysis_prompt_enable: true,
        analysis_prompt: "自定义分析：{target_language}",
      }),
      [],
    );

    const result = await builder.build_glossary_analysis_main();

    expect(result).toContain("分析前缀");
    expect(result).toContain("自定义分析：中文");
    expect(result).toContain("分析思考");
    expect(result).not.toContain("翻译前缀");
  });

  it("含姓名请求使用 actor/text 格式并写入已激活姓名术语", async () => {
    const builtin_root = await create_template_root();
    const builder = new PromptBuilder(
      builtin_root,
      {
        app_language: "ZH",
        source_language: "JA",
        target_language: "ZH",
      },
      create_quality_snapshot(),
      [
        {
          entry_id: "name",
          src: "虎鉄",
          dst: "虎铁",
          info: "男性人名",
          case_sensitive: false,
        },
      ],
    );

    const result = await builder.generate_prompt(
      [
        create_line({ request_index: 0, text_src: "こんにちは", actor_src: "虎鉄" }),
        create_line({ request_index: 1, text_src: "地の文", actor_src: null }),
      ],
      "actor_text",
      [],
      [],
    );

    expect(result.messages[0]?.content).toContain(
      '{"index":<序号>,"actor":"<姓名译文或null>","text":"<正文译文>"}',
    );
    expect(result.messages[1]?.content).toContain('{"index":0,"actor":"虎鉄","text":"こんにちは"}');
    expect(result.messages[1]?.content).toContain('{"index":1,"actor":null,"text":"地の文"}');
    expect(result.messages[1]?.content).toContain("虎鉄 -> 虎铁 #男性人名");
  });

  it("纯文本请求使用字符串 JSONL 输入格式", async () => {
    const builtin_root = await create_template_root();
    const builder = new PromptBuilder(
      builtin_root,
      { app_language: "ZH", source_language: "JA", target_language: "ZH" },
      create_quality_snapshot(),
      [],
    );

    const result = await builder.generate_prompt(
      [create_line({ request_index: 0, text_src: "こんにちは" })],
      "text",
      [],
      [],
    );

    expect(result.messages[0]?.content).toContain('{"index":<序号>,"text":"<译文文本>"}');
    expect(result.messages[1]?.content).toContain('{"index":0,"text":"こんにちは"}');
  });
});

/**
 * 构造包含中英文提示词模板的临时内置资产根，避免测试依赖仓库资源
 */
async function create_template_root(): Promise<string> {
  const builtin_root = await mkdtemp(path.join(tmpdir(), "linguagacha-prompt-"));
  template_roots.push(builtin_root);
  await write_template(builtin_root, "translation_prompt", "zh", {
    prefix: "翻译前缀",
    base: "请从 {source_language} 翻译到 {target_language}，保留控制字符。",
    thinking: "思考过程",
    suffix: "输出 JSONLINE\n{translation_output_format}",
  });
  await write_template(builtin_root, "analysis_prompt", "en", {
    prefix: "Analysis prefix",
    base: "Extract terms for {target_language}.",
    thinking: "",
    suffix: "Return JSONLINE",
  });
  await write_template(builtin_root, "translation_prompt", "en", {
    prefix: "Translation prefix",
    base: "Translate from {source_language} to {target_language}.",
    thinking: "",
    suffix: "Return JSONLINE\n{translation_output_format}",
  });
  await write_template(builtin_root, "analysis_prompt", "zh", {
    prefix: "分析前缀",
    base: "提取 {target_language} 术语。",
    thinking: "分析思考",
    suffix: "输出 JSONLINE",
  });
  return builtin_root;
}

/**
 * 写入单个任务语言模板，保持 PromptBuilder 读取路径与运行态一致
 */
async function write_template(
  builtin_root: string,
  task_dir_name: string,
  language: "zh" | "en",
  sections: Record<"prefix" | "base" | "thinking" | "suffix", string>,
): Promise<void> {
  const dir = path.join(builtin_root, task_dir_name, "template", language);
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

/**
 * 构造提示词输入行，默认 actor 为空以保持纯文本模式。
 */
function create_line(overrides: {
  request_index?: number;
  text_src: string;
  actor_src?: TranslationActor;
}): TranslationRequestItem {
  return {
    request_index: overrides.request_index ?? 0,
    item_index: 0,
    text_src: overrides.text_src,
    actor_src: overrides.actor_src ?? null,
  };
}
