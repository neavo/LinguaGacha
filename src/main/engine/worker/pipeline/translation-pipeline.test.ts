import { afterEach, describe, expect, it, vi } from "vitest";

import { CodeFixer } from "../../../../shared/fixer/code-fixer";
import { EscapeFixer } from "../../../../shared/fixer/escape-fixer";
import { HangeulFixer } from "../../../../shared/fixer/hangeul-fixer";
import { KanaFixer } from "../../../../shared/fixer/kana-fixer";
import { NumberFixer } from "../../../../shared/fixer/number-fixer";
import { PunctuationFixer } from "../../../../shared/fixer/punctuation-fixer";
import type {
  TextProcessingConfig,
  TextQualitySnapshot,
  TextTaskItemRecord,
} from "../../../../shared/text/text-types";
import { TranslationPostPipeline } from "./translation-post-pipeline";
import { TranslationPrePipeline } from "./translation-pre-pipeline";

describe("翻译文本 pipeline", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("译前记录并剥离每行头尾空白", () => {
    const pipeline = create_pipeline_pair(create_config(), create_quality_snapshot());

    const context = pipeline.pre.process_item({
      src: "  hello\t ",
      text_type: "TXT",
    });

    expect(context.srcs).toEqual(["hello"]);
    expect(context.leading_whitespace_by_line).toEqual(new Map([[0, "  "]]));
    expect(context.trailing_whitespace_by_line).toEqual(new Map([[0, "\t "]]));
  });

  it("译前抽取保护前后缀并在译后恢复原始空白", () => {
    const pipeline = create_pipeline_pair(
      create_config(),
      create_quality_snapshot({
        text_preserve_mode: "CUSTOM",
        text_preserve_entries: [{ src: "\\\\n\\[\\d+\\]" }],
      }),
    );
    const context = pipeline.pre.process_item({
      src: "  \\n[1]こんにちは\\n[2]  ",
      text_type: "TXT",
    });

    const result = pipeline.post.process_item(context, ["你好"]);

    expect(context.srcs).toEqual(["こんにちは"]);
    expect(result.dst).toBe("  \\n[1]你好\\n[2]  ");
  });

  it("小写 smart 模式使用共享预置规则保护脚本控制码", () => {
    const pipeline = create_pipeline_pair(
      create_config(),
      create_quality_snapshot({
        text_preserve_mode: "smart",
      }),
    );
    const context = pipeline.pre.process_item({
      src: "@12こんにちは",
      text_type: "WOLF",
    });

    const result = pipeline.post.process_item(context, ["你好"]);

    expect(context.srcs).toEqual(["こんにちは"]);
    expect(result.dst).toBe("@12你好");
  });

  it("小写 off 模式不会误用快照里的自定义保护规则", () => {
    const pipeline = create_pipeline_pair(
      create_config(),
      create_quality_snapshot({
        text_preserve_mode: "off",
        text_preserve_entries: [{ src: "\\\\n\\[\\d+\\]" }],
      }),
    );

    const context = pipeline.pre.process_item({
      src: "\\n[1]こんにちは",
      text_type: "TXT",
    });

    expect(context.srcs).toEqual(["\\n[1]こんにちは"]);
  });

  it("译前正规化保持旧格式全角和半角片假名映射", () => {
    const pipeline = create_pipeline_pair(create_config(), create_quality_snapshot());

    const context = pipeline.pre.process_item({
      src: "ＡＢ１２ｱｲ",
      text_type: "TXT",
    });

    expect(context.srcs).toEqual(["AB12アイ"]);
  });

  it("普通替换按字面量写入并避免 JS 替换占位符误生效", () => {
    const pipeline = create_pipeline_pair(
      create_config(),
      create_quality_snapshot({
        pre_replacement_enable: true,
        pre_replacement_entries: [
          {
            src: "ABC",
            dst: "$&",
            regex: false,
            case_sensitive: false,
          },
        ],
      }),
    );

    const context = pipeline.pre.process_item({
      src: "abc AbC",
      text_type: "TXT",
    });

    expect(context.srcs).toEqual(["$& $&"]);
  });

  it("正则替换兼容历史反向引用并保留 JS 美元占位字面量", () => {
    const pipeline = create_pipeline_pair(
      create_config(),
      create_quality_snapshot({
        pre_replacement_enable: true,
        pre_replacement_entries: [
          {
            src: "(A)(B)",
            dst: "\\2\\1-$&",
            regex: true,
            case_sensitive: false,
          },
        ],
      }),
    );

    const context = pipeline.pre.process_item({
      src: "ab",
      text_type: "TXT",
    });

    expect(context.srcs).toEqual(["ba-$&"]);
  });

  it("姓名注入和译后姓名抽取只影响带 name_src 的 item", () => {
    const item: TextTaskItemRecord = {
      src: "こんにちは",
      name_src: ["Alice"],
      text_type: "TXT",
    };
    const pipeline = create_pipeline_pair(create_config(), create_quality_snapshot());

    const context = pipeline.pre.process_item(item);
    const result = pipeline.post.process_item(context, ["【爱丽丝】你好"]);

    expect(context.srcs).toEqual(["【Alice】こんにちは"]);
    expect(result).toEqual({ name: "爱丽丝", dst: "你好" });
  });

  it("空 item 会返回同一形状的空上下文和空译后结果", () => {
    const pipeline = create_pipeline_pair(create_config(), create_quality_snapshot());

    const context = pipeline.pre.process_item(null);
    const result = pipeline.post.process_item(context, ["ignored"]);

    expect(context.srcs).toEqual([]);
    expect(context.samples).toEqual([]);
    expect(context.valid_line_indexes).toEqual(new Set());
    expect(result).toEqual({ name: null, dst: "" });
  });

  it("译前跳过空白行并为 Markdown 追加固定控制字符示例", () => {
    const pipeline = create_pipeline_pair(
      create_config(),
      create_quality_snapshot({
        text_preserve_mode: "OFF",
      }),
    );

    const context = pipeline.pre.process_item({
      src: "   \nhello",
      text_type: "MD",
    });

    expect(context.srcs).toEqual(["hello"]);
    expect(context.valid_line_indexes).toEqual(new Set([1]));
    expect(context.samples).toEqual(["Markdown Code"]);
  });

  it("启用 ruby 清理时 EPUB 块级候选会成为译前和译后的对齐文本", () => {
    const pipeline = create_pipeline_pair(
      create_config({ clean_ruby: true }),
      create_quality_snapshot({ text_preserve_mode: "OFF" }),
    );

    const context = pipeline.pre.process_item({
      src: "宝條\n直希",
      text_type: "TXT",
      extra_field: {
        epub: {
          ruby_clean_candidate: {
            cleaned_src: "宝條直希",
            block_path: "/html[1]/body[1]/p[1]",
            cleaned_digest: "digest",
          },
        },
      },
    });
    const result = pipeline.post.process_item(context, ["宝条直希"]);

    expect(context.srcs).toEqual(["宝條直希"]);
    expect(context.valid_line_indexes).toEqual(new Set([0]));
    expect(result).toEqual({ name: null, dst: "宝条直希" });
  });

  it("关闭 ruby 清理时 EPUB 块级候选不会改变原始分行", () => {
    const pipeline = create_pipeline_pair(
      create_config({ clean_ruby: false }),
      create_quality_snapshot({ text_preserve_mode: "OFF" }),
    );

    const context = pipeline.pre.process_item({
      src: "宝條\n直希",
      text_type: "TXT",
      extra_field: {
        epub: {
          ruby_clean_candidate: {
            cleaned_src: "宝條直希",
          },
        },
      },
    });

    expect(context.srcs).toEqual(["宝條", "直希"]);
    expect(context.valid_line_indexes).toEqual(new Set([0, 1]));
  });

  it("关闭自动前后缀保护时保留原文并跳过完全保护行", () => {
    const pipeline = create_pipeline_pair(
      create_config({ auto_process_prefix_suffix_preserved_text: false }),
      create_quality_snapshot({
        text_preserve_mode: "CUSTOM",
        text_preserve_entries: [{ src: "<[^>]+>" }],
      }),
    );

    const fully_preserved = pipeline.pre.process_item({
      src: "<b></b>",
      text_type: "TXT",
    });
    const partially_preserved = pipeline.pre.process_item({
      src: "<b>hello</b>",
      text_type: "TXT",
    });

    expect(fully_preserved.srcs).toEqual([]);
    expect(fully_preserved.valid_line_indexes).toEqual(new Set());
    expect(partially_preserved.srcs).toEqual(["<b>hello</b>"]);
    expect(partially_preserved.prefix_codes_by_line).toEqual(new Map());
    expect(partially_preserved.suffix_codes_by_line).toEqual(new Map());
  });

  it("关闭自动前后缀保护时只跳过混合文本里的完全保护行", () => {
    const pipeline = create_pipeline_pair(
      create_config({ auto_process_prefix_suffix_preserved_text: false }),
      create_quality_snapshot({
        text_preserve_mode: "CUSTOM",
        text_preserve_entries: [{ src: "<[^>]+>" }],
      }),
    );

    const context = pipeline.pre.process_item({
      src: "<b></b>\nhello\n<i></i>",
      text_type: "TXT",
    });

    expect(context.srcs).toEqual(["hello"]);
    expect(context.valid_line_indexes).toEqual(new Set([1]));
  });

  it("保护模式关闭时即使自动前后缀保护关闭也不会跳过整行代码", () => {
    const pipeline = create_pipeline_pair(
      create_config({ auto_process_prefix_suffix_preserved_text: false }),
      create_quality_snapshot({
        text_preserve_mode: "OFF",
        text_preserve_entries: [{ src: "<[^>]+>" }],
      }),
    );

    const context = pipeline.pre.process_item({
      src: "<b></b>",
      text_type: "TXT",
    });

    expect(context.srcs).toEqual(["<b></b>"]);
    expect(context.valid_line_indexes).toEqual(new Set([0]));
  });

  it("译后保留空行、纯空白行和未进入模型的行", () => {
    const pipeline = create_pipeline_pair(create_config(), create_quality_snapshot());
    const context = pipeline.pre.process_item({
      src: "line\n \nskip",
      text_type: "TXT",
    });
    context.valid_line_indexes.delete(2);

    const result = pipeline.post.process_item(context, ["ok"]);

    expect(result.dst).toBe("ok\n \nskip");
  });

  it("译后会移除模型额外添加的头尾空白再恢复原始空白", () => {
    const pipeline = create_pipeline_pair(
      create_config(),
      create_quality_snapshot({ text_preserve_mode: "OFF" }),
    );
    const context = pipeline.pre.process_item({
      src: "  line  ",
      text_type: "TXT",
    });

    const result = pipeline.post.process_item(context, ["  ok  "]);

    expect(result.dst).toBe("  ok  ");
  });

  it("译前译后处理混合多行、姓名和前后缀保护", () => {
    const pipeline = create_pipeline_pair(
      create_config(),
      create_quality_snapshot({
        text_preserve_mode: "CUSTOM",
        text_preserve_entries: [{ src: "<[^>]+>" }],
      }),
    );

    const context = pipeline.pre.process_item({
      src: "  <b>one</b>  \n\n  two  ",
      name_src: "Alice",
      text_type: "TXT",
    });
    const result = pipeline.post.process_item(context, ["【Alicia】uno", "dos"]);

    expect(context.srcs).toEqual(["【Alice】one", "two"]);
    expect(context.valid_line_indexes).toEqual(new Set([0, 2]));
    expect(context.prefix_codes_by_line).toEqual(
      new Map([
        [0, ["<b>"]],
        [2, []],
      ]),
    );
    expect(context.suffix_codes_by_line).toEqual(
      new Map([
        [0, ["</b>"]],
        [2, []],
      ]),
    );
    expect(result).toEqual({
      name: "Alicia",
      dst: "  <b>uno</b>  \n\n  dos  ",
    });
  });

  it("译前和译后替换在 pipeline 中按快照开关执行", () => {
    const pipeline = create_pipeline_pair(
      create_config(),
      create_quality_snapshot({
        text_preserve_mode: "OFF",
        pre_replacement_enable: true,
        pre_replacement_entries: [
          {
            src: "foo",
            dst: "f1",
            regex: false,
            case_sensitive: false,
          },
        ],
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

    const context = pipeline.pre.process_item({
      src: "  foo  \nbar",
      text_type: "TXT",
    });
    const result = pipeline.post.process_item(context, ["a u", "b u"]);

    expect(context.srcs).toEqual(["f1", "bar"]);
    expect(context.valid_line_indexes).toEqual(new Set([0, 1]));
    expect(result.dst).toBe("  a U  \nb U");
  });

  it("带姓名的 item 译后没有姓名前缀时保留译文并不产生 name", () => {
    const pipeline = create_pipeline_pair(create_config(), create_quality_snapshot());
    const context = pipeline.pre.process_item({
      src: "hello",
      name_src: "Alice",
      text_type: "TXT",
    });

    const result = pipeline.post.process_item(context, ["hi"]);

    expect(result).toEqual({ name: null, dst: "hi" });
  });

  it("自动修复在日文源语言下按语言、代码、转义、数字、标点顺序执行", () => {
    const calls: string[] = [];
    vi.spyOn(KanaFixer, "fix").mockImplementation((dst) => {
      calls.push("kana");
      return `${dst}-k`;
    });
    vi.spyOn(HangeulFixer, "fix").mockImplementation((dst) => {
      throw new Error(`不应调用韩文修复：${dst}`);
    });
    vi.spyOn(CodeFixer, "fix").mockImplementation((src, dst) => {
      calls.push("code");
      expect(src).toBe("src");
      expect(dst).toBe("dst-k");
      return `${dst}-c`;
    });
    vi.spyOn(EscapeFixer, "fix").mockImplementation((src, dst) => {
      calls.push("escape");
      expect(src).toBe("src");
      return `${dst}-e`;
    });
    vi.spyOn(NumberFixer, "fix").mockImplementation((src, dst) => {
      calls.push("number");
      expect(src).toBe("src");
      return `${dst}-n`;
    });
    vi.spyOn(PunctuationFixer, "fix").mockImplementation(
      (src, dst, source_language, target_language) => {
        calls.push("punctuation");
        expect(src).toBe("src");
        expect(source_language).toBe("JA");
        expect(target_language).toBe("ZH");
        return `${dst}-p`;
      },
    );

    const pipeline = create_pipeline_pair(
      create_config({ source_language: "JA", target_language: "ZH" }),
      create_quality_snapshot({ text_preserve_mode: "OFF" }),
    );
    const context = pipeline.pre.process_item({ src: "src", text_type: "TXT" });
    const result = pipeline.post.process_item(context, ["dst"]);

    expect(result.dst).toBe("dst-k-c-e-n-p");
    expect(calls).toEqual(["kana", "code", "escape", "number", "punctuation"]);
  });

  it("自动修复在韩文源语言下使用谚文修复路径", () => {
    vi.spyOn(KanaFixer, "fix").mockImplementation((dst) => {
      throw new Error(`不应调用日文修复：${dst}`);
    });
    vi.spyOn(HangeulFixer, "fix").mockImplementation((dst) => `${dst}-h`);
    vi.spyOn(CodeFixer, "fix").mockImplementation((_src, dst) => dst);
    vi.spyOn(EscapeFixer, "fix").mockImplementation((_src, dst) => dst);
    vi.spyOn(NumberFixer, "fix").mockImplementation((_src, dst) => dst);
    vi.spyOn(PunctuationFixer, "fix").mockImplementation((_src, dst) => dst);

    const pipeline = create_pipeline_pair(
      create_config({ source_language: "KO", target_language: "ZH" }),
      create_quality_snapshot({ text_preserve_mode: "OFF" }),
    );
    const context = pipeline.pre.process_item({ src: "src", text_type: "TXT" });
    const result = pipeline.post.process_item(context, ["dst"]);

    expect(result.dst).toBe("dst-h");
  });

  it("自动修复在其它源语言下跳过语言残留专用修复", () => {
    vi.spyOn(KanaFixer, "fix").mockImplementation((dst) => {
      throw new Error(`不应调用日文修复：${dst}`);
    });
    vi.spyOn(HangeulFixer, "fix").mockImplementation((dst) => {
      throw new Error(`不应调用韩文修复：${dst}`);
    });
    vi.spyOn(CodeFixer, "fix").mockImplementation((_src, dst) => `${dst}-c`);
    vi.spyOn(EscapeFixer, "fix").mockImplementation((_src, dst) => `${dst}-e`);
    vi.spyOn(NumberFixer, "fix").mockImplementation((_src, dst) => `${dst}-n`);
    vi.spyOn(PunctuationFixer, "fix").mockImplementation((_src, dst) => `${dst}-p`);

    const pipeline = create_pipeline_pair(
      create_config({ source_language: "ZH", target_language: "EN" }),
      create_quality_snapshot({ text_preserve_mode: "OFF" }),
    );
    const context = pipeline.pre.process_item({ src: "src", text_type: "TXT" });
    const result = pipeline.post.process_item(context, ["dst"]);

    expect(result.dst).toBe("dst-c-e-n-p");
  });
});

/**
 * 构造译前和译后 pipeline，确保同一用例共享同一批配置快照
 */
function create_pipeline_pair(config: TextProcessingConfig, quality_snapshot: TextQualitySnapshot) {
  return {
    pre: new TranslationPrePipeline(config, quality_snapshot),
    post: new TranslationPostPipeline(config, quality_snapshot),
  };
}

/**
 * 生成翻译 pipeline 默认配置，测试通过 overrides 聚焦单个规则分支
 */
function create_config(overrides: Partial<TextProcessingConfig> = {}): TextProcessingConfig {
  return {
    source_language: "JA",
    target_language: "ZH",
    clean_ruby: false,
    check_kana_residue: true,
    check_hangeul_residue: true,
    check_similarity: true,
    auto_process_prefix_suffix_preserved_text: true,
    ...overrides,
  };
}

/**
 * 生成默认质量快照，避免每个用例重复书写完整规则结构
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
