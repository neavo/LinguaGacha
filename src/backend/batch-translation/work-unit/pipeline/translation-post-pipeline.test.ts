import { describe, expect, it } from "vitest";
import type { TextProcessingConfig, TextQualitySnapshot } from "../../../../shared/text/text-types";
import { TranslationPostPipeline } from "./translation-post-pipeline";
import {
  TranslationPrePipeline,
  type TranslationPrePipelineContext,
} from "./translation-pre-pipeline";

describe("TranslationPostPipeline", () => {
  it.each([
    ["<b>你好</b>", "<b>你好</b>"],
    ["你好", "你好"],
    ["<b><b>你好</b></b>", "<b>你好</b>"],
  ])("按完整请求中的保护段处理模型响应：%s", (response, expected) => {
    const { pre, post } = create_pipeline_pair(
      create_config(),
      create_quality_snapshot({
        text_preserve_mode: "CUSTOM",
        text_preserve_entries: [{ src: "<[^>]+>", info: "" }],
      }),
    );
    const context = pre.process_item({ src: "<b>hello</b>", text_type: "TXT" });

    expect(process_text(post, context, [response])).toBe(expected);
  });

  it("译前和译后替换覆盖首尾保护段", () => {
    const { pre, post } = create_pipeline_pair(
      create_config(),
      create_quality_snapshot({
        text_preserve_mode: "CUSTOM",
        text_preserve_entries: [{ src: "<[^>]+>", info: "" }],
        pre_replacement_enable: true,
        pre_replacement_entries: [{ src: "A", dst: "B", regex: false, case_sensitive: true }],
        post_replacement_enable: true,
        post_replacement_entries: [{ src: "B", dst: "C", regex: false, case_sensitive: true }],
      }),
    );
    const context = pre.process_item({ src: "<A>hello</A>", text_type: "TXT" });

    expect(context.request_item?.text_src).toBe("<B>hello</B>");
    expect(process_text(post, context, ["<B>你好</B>"])).toBe("<C>你好</C>");
  });

  it("使用包含保护段的源文恢复标点和圆圈数字", () => {
    const { pre, post } = create_pipeline_pair(
      create_config(),
      create_quality_snapshot({
        text_preserve_mode: "CUSTOM",
        text_preserve_entries: [{ src: "\\\\n\\[\\d+\\]", info: "" }],
      }),
    );
    const context = pre.process_item({
      src: "  \\n[7]「①」\\n[8]  ",
      text_type: "TXT",
    });

    expect(process_text(post, context, ['\\n[7]"1"\\n[8]'])).toBe("  \\n[7]「①」\\n[8]  ");
  });

  it("行数对应时恢复空白行和完全保护行", () => {
    const { pre, post } = create_pipeline_pair(
      create_config(),
      create_quality_snapshot({
        text_preserve_mode: "CUSTOM",
        text_preserve_entries: [{ src: "<[^>]+>", info: "" }],
      }),
    );
    const context = pre.process_item({
      src: "line\n \n<skip>",
      text_type: "TXT",
    });

    const result = process_text(post, context, ["ok", "模型改写空行", "<changed>"]);

    expect(result).toBe("ok\n \n<skip>");
  });

  it("译后会移除模型额外添加的头尾空白再恢复原始空白", () => {
    const { pre, post } = create_pipeline_pair(
      create_config(),
      create_quality_snapshot({ text_preserve_mode: "OFF" }),
    );
    const context = pre.process_item({
      src: "  line  ",
      text_type: "TXT",
    });

    const result = process_text(post, context, ["  ok  "]);

    expect(result).toBe("  ok  ");
  });

  it("混合多行文本保留模型标签并恢复空白", () => {
    const { pre, post } = create_pipeline_pair(
      create_config(),
      create_quality_snapshot({
        text_preserve_mode: "CUSTOM",
        text_preserve_entries: [{ src: "<[^>]+>", info: "" }],
      }),
    );

    const context = pre.process_item({
      src: "  <b>one</b>  \n\n  two  ",
      name_src: "Alice",
      text_type: "TXT",
    });
    const result = process_text(post, context, ["<b>uno</b>", "", "dos"]);

    expect(result).toBe("  <b>uno</b>  \n\n  dos  ");
  });

  it("译后替换按质量快照开关执行", () => {
    const { pre, post } = create_pipeline_pair(
      create_config(),
      create_quality_snapshot({
        text_preserve_mode: "OFF",
        post_replacement_enable: true,
        post_replacement_entries: [
          {
            src: "u",
            dst: "U",
            regex: false,
            case_sensitive: true,
          },
        ],
      }),
    );

    const context = pre.process_item({
      src: "  foo  \nbar",
      text_type: "TXT",
    });
    const result = process_text(post, context, ["a u", "b u"]);

    expect(result).toBe("  a U  \nb U");
  });

  it("actor/text 模式返回正文和姓名译文", () => {
    const { pre, post } = create_pipeline_pair(create_config(), create_quality_snapshot());
    const context = pre.process_item({
      src: "hello",
      name_src: "Alice",
      text_type: "TXT",
    });

    const result = post.process_item(
      context,
      { request_id: 0, text_dst: "hi", actor_dst: "爱丽丝" },
      "actor_text",
    );

    expect(result).toEqual({ dst: "hi", name_dst: "爱丽丝" });
  });

  it("在译后处理末尾恢复正文和姓名中的临时引用", () => {
    const { pre, post } = create_pipeline_pair(create_config(), create_quality_snapshot());
    const context = pre.process_item({
      src: "查看 https://example.com/guide",
      name_src: "data:image/png;base64,AAAA",
      text_type: "TXT",
    });

    const result = post.process_item(
      context,
      { request_id: 0, text_dst: "请看 lg-uri/1", actor_dst: "lg-uri/0" },
      "actor_text",
    );

    expect(result).toEqual({
      dst: "请看 https://example.com/guide",
      name_dst: "data:image/png;base64,AAAA",
    });
  });

  it("译前和译后替换不改写临时引用", () => {
    const { pre, post } = create_pipeline_pair(
      create_config(),
      create_quality_snapshot({
        pre_replacement_enable: true,
        pre_replacement_entries: [{ src: "uri", dst: "URI", regex: false, case_sensitive: true }],
        post_replacement_enable: true,
        post_replacement_entries: [{ src: "uri", dst: "URI", regex: false, case_sensitive: true }],
      }),
    );
    const context = pre.process_item({
      src: "uri https://example.com",
      text_type: "TXT",
    });

    expect(context.request_item?.text_src).toBe("URI lg-uri/0");
    expect(process_text(post, context, ["uri lg-uri/0"])).toBe("URI https://example.com");
  });

  it("混合姓名请求不会把无姓名源行的模型 actor 写回姓名", () => {
    const { pre, post } = create_pipeline_pair(create_config(), create_quality_snapshot());
    const context = pre.process_item(
      {
        src: "hello",
        text_type: "TXT",
      },
      0,
      2,
    );

    const result = post.process_item(
      context,
      { request_id: 2, text_dst: "hi", actor_dst: "旁白" },
      "actor_text",
    );

    expect(result).toEqual({ dst: "hi" });
  });

  it("带姓名源行但模型返回空 actor 时明确返回空姓名译文", () => {
    const { pre, post } = create_pipeline_pair(create_config(), create_quality_snapshot());
    const context = pre.process_item({
      src: "hello",
      name_src: "Alice",
      text_type: "TXT",
    });

    const result = post.process_item(
      context,
      { request_id: 0, text_dst: "hi", actor_dst: null },
      "actor_text",
    );

    expect(result).toEqual({ dst: "hi", name_dst: null });
  });

  it("组合应用代码和数字修复后返回最终译文", () => {
    const { pre, post } = create_pipeline_pair(
      create_config(),
      create_quality_snapshot({
        text_preserve_mode: "CUSTOM",
        text_preserve_entries: [{ src: "<[^>]+>", info: "" }],
      }),
    );
    const context = pre.process_item({ src: "A<1>①", text_type: "TXT" });

    expect(process_text(post, context, ["B<x><1>1"])).toBe("B<1>①");
  });

  it("保护段使用模型源文，数字形式使用恢复源文", () => {
    const { pre, post } = create_pipeline_pair(
      create_config(),
      create_quality_snapshot({
        text_preserve_mode: "CUSTOM",
        text_preserve_entries: [{ src: "<[^>]+>", info: "" }],
        pre_replacement_enable: true,
        pre_replacement_entries: [{ src: "①", dst: "<Q>1", regex: false, case_sensitive: true }],
      }),
    );
    const context = pre.process_item({ src: "①", text_type: "TXT" });

    expect(process_text(post, context, ["<Q>1"])).toBe("<Q>①");
  });

  it("行数不一致时不执行缺少逐行证据的自动恢复", () => {
    const { pre, post } = create_pipeline_pair(create_config(), create_quality_snapshot());
    const context = pre.process_item({ src: "①\n②", text_type: "TXT" });

    const result = post.process_item(
      context,
      { request_id: 0, text_dst: "1", actor_dst: null },
      "text",
    );

    expect(result.dst).toBe("1");
  });

  it("行数不一致时仍按 Item 恢复临时引用", () => {
    const { pre, post } = create_pipeline_pair(create_config(), create_quality_snapshot());
    const context = pre.process_item({
      src: "第一行 https://example.com\n第二行",
      text_type: "TXT",
    });

    const result = post.process_item(
      context,
      { request_id: 0, text_dst: "合并 lg-uri/0", actor_dst: null },
      "text",
    );

    expect(result.dst).toBe("合并 https://example.com");
  });

  it("保留模型返回的语言字符并交给校对判断", () => {
    const cases = [
      { source_language: "JA", dst: "AっB", expected: "AっB" },
      { source_language: "KO", dst: "A뿅B", expected: "A뿅B" },
      { source_language: "EN", dst: "AっB뿅C", expected: "AっB뿅C" },
    ] as const;

    for (const { source_language, dst, expected } of cases) {
      const { pre, post } = create_pipeline_pair(
        create_config({ source_language }),
        create_quality_snapshot(),
      );
      const context = pre.process_item({ src: "source", text_type: "TXT" });

      expect(process_text(post, context, [dst])).toBe(expected);
    }
  });
});

/**
 * 构造译前和译后 pipeline，确保同一用例共享同一批配置快照。
 */
function create_pipeline_pair(config: TextProcessingConfig, quality_snapshot: TextQualitySnapshot) {
  return {
    pre: new TranslationPrePipeline(config, quality_snapshot),
    post: new TranslationPostPipeline(config, quality_snapshot),
  };
}

/** 以完整模型响应执行译后流程，测试输入显式包含每一行。 */
function process_text(
  post_pipeline: TranslationPostPipeline,
  context: TranslationPrePipelineContext,
  dsts: string[],
): string {
  return post_pipeline.process_item(
    context,
    {
      request_id: context.request_item?.request_id ?? 0,
      text_dst: dsts.join("\n"),
      actor_dst: null,
    },
    "text",
  ).dst;
}

/**
 * 生成翻译 pipeline 默认配置，测试通过 overrides 聚焦单个规则分支。
 */
function create_config(overrides: Partial<TextProcessingConfig> = {}): TextProcessingConfig {
  return {
    source_language: "JA",
    target_language: "ZH",
    clean_ruby: false,
    ...overrides,
  };
}

/**
 * 生成默认质量快照，避免每个用例重复书写完整规则结构。
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

    ...overrides,
  };
}
