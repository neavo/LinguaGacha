import { describe, expect, it } from "vitest";
import type { TextProcessingConfig, TextQualitySnapshot } from "../../../../shared/text/text-types";
import type { TranslationDecodedLine } from "../translation-line";
import { TranslationPostPipeline } from "./translation-post-pipeline";
import {
  TranslationPrePipeline,
  type TranslationPrePipelineContext,
} from "./translation-pre-pipeline";

describe("TranslationPostPipeline", () => {
  it("按译前上下文恢复保护前后缀和原始空白", () => {
    const { pre, post } = create_pipeline_pair(
      create_config(),
      create_quality_snapshot({
        text_preserve_mode: "CUSTOM",
        text_preserve_entries: [{ src: "\\\\n\\[\\d+\\]", info: "" }],
      }),
    );
    const context = pre.process_item({
      src: "  \\n[1]こんにちは\\n[2]  ",
      text_type: "TXT",
    });

    const result = process_text(post, context, ["你好"]);

    expect(result).toBe("  \\n[1]你好\\n[2]  ");
  });

  it("空 item 返回空译后结果", () => {
    const { pre, post } = create_pipeline_pair(create_config(), create_quality_snapshot());

    const result = process_text(post, pre.process_item(null), ["ignored"]);

    expect(result).toBe("");
  });

  it("译后保留空行、纯空白行和未进入模型的行", () => {
    const { pre, post } = create_pipeline_pair(create_config(), create_quality_snapshot());
    const context = pre.process_item({
      src: "line\n \nskip",
      text_type: "TXT",
    });
    context.valid_line_indexes.delete(2);

    const result = process_text(post, context, ["ok"]);

    expect(result).toBe("ok\n \nskip");
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

  it("处理混合多行和前后缀保护时按行恢复译文", () => {
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
    const result = process_text(post, context, ["uno", "dos"]);

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
      [
        {
          request_index: 0,
          text_dst: "hi",
          actor_dst: "爱丽丝",
        },
      ],
      "actor_text",
    );

    expect(result).toEqual({ dst: "hi", name_dst: "爱丽丝" });
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
      [
        {
          request_index: 2,
          text_dst: "hi",
          actor_dst: "旁白",
        },
      ],
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
      [
        {
          request_index: 0,
          text_dst: "hi",
          actor_dst: null,
        },
      ],
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

  it("按源语言选择日文、韩文或无语言残留修复", () => {
    const cases = [
      { source_language: "JA", dst: "AっB", expected: "AB" },
      { source_language: "KO", dst: "A뿅B", expected: "AB" },
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

/**
 * 以 text 模式执行译后流程，隐藏测试里重复的 decoded line 组装。
 */
function process_text(
  post_pipeline: TranslationPostPipeline,
  context: TranslationPrePipelineContext,
  dsts: string[],
): string {
  return post_pipeline.process_item(context, decoded_lines(context, dsts), "text").dst;
}

/**
 * 根据译前行序号构造模型解码结果，保持回填路径与运行态一致。
 */
function decoded_lines(
  context: TranslationPrePipelineContext,
  dsts: string[],
): TranslationDecodedLine[] {
  return context.lines.map((line, index) => ({
    request_index: line.request_index,
    text_dst: dsts[index] ?? "",
    actor_dst: null,
  }));
}

/**
 * 生成翻译 pipeline 默认配置，测试通过 overrides 聚焦单个规则分支。
 */
function create_config(overrides: Partial<TextProcessingConfig> = {}): TextProcessingConfig {
  return {
    source_language: "JA",
    target_language: "ZH",
    clean_ruby: false,
    auto_process_prefix_suffix_preserved_text: true,
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
    analysis_prompt_enable: false,
    analysis_prompt: "",
    ...overrides,
  };
}
