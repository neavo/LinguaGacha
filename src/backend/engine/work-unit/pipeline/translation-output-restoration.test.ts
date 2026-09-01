import { describe, expect, it } from "vitest";

import {
  build_text_preserve_rule,
  type TextPreserveRule,
} from "../../../../shared/text/text-preserve-rules";
import { restore_translation_line } from "./translation-output-restoration";

describe("restore_translation_line", () => {
  it("只删除有序期望序列之外的额外保护段", () => {
    const rule = create_rule(["<[^>]+>"]);

    expect(
      restore({
        model_text: "A<1>B<3>C",
        restoration_text: "A<1>B<3>C",
        translation: "A<1>B<x><3><y>C",
        preserve_rule: rule,
      }),
    ).toBe("A<1>B<3>C");
    expect(
      restore({
        model_text: "A<1>B<2>C",
        restoration_text: "A<1>B<2>C",
        translation: "A<1><x>B<3>C",
        preserve_rule: rule,
      }),
    ).toBe("A<1><x>B<3>C");
  });

  it("按后继字符恢复反斜杠段长度", () => {
    const source = String.raw`\\n[1] \\E`;
    expect(
      restore({ restoration_text: source, model_text: source, translation: String.raw`\n[1] \E` }),
    ).toBe(source);

    const reordered = String.raw`\b \a`;
    expect(
      restore({
        restoration_text: String.raw`\\a \\b`,
        model_text: String.raw`\\a \\b`,
        translation: reordered,
      }),
    ).toBe(reordered);
  });

  it("全部数字值一致时一次性恢复圆圈数字形式", () => {
    expect(
      restore({ restoration_text: "① 2 ㉑", model_text: "① 2 ㉑", translation: "1 2 21" }),
    ).toBe("① 2 ㉑");

    const mismatched = "1 3";
    expect(restore({ restoration_text: "① 2", model_text: "① 2", translation: mismatched })).toBe(
      mismatched,
    );
  });

  it.each([
    ["源文日式钩括号恢复到译文边界", "「你好」", '"你好"', "JA", "JA", "「你好」"],
    ["CJK 目标归一弯双引号", "“你好”", '"你好"', "ZH", "ZH", "「你好」"],
    ["源文行内全角空格保持原形", "甲　乙", "甲 乙", "JA", "ZH", "甲　乙"],
    ["非 CJK 译为 CJK 时保留译文全角标点", "A:B", "A：B", "EN", "ZH", "A：B"],
    ["非 CJK 互译时恢复源文半角标点", "A:B", "A：B", "EN", "EN", "A:B"],
    ["CJK 译为非 CJK 时恢复源文全角标点", "A：B", "A:B", "JA", "EN", "A：B"],
  ] as const)("%s", (_name, source, translation, source_language, target_language, expected) => {
    expect(
      restore({
        restoration_text: source,
        model_text: source,
        translation,
        source_language,
        target_language,
      }),
    ).toBe(expected);
  });

  it("标点稳定只处理保护段之外的内容", () => {
    const rule = create_rule(["<[^>]+>"]);
    expect(
      restore({
        restoration_text: "<tag title=“name”>“text”",
        model_text: "<tag title=“name”>“text”",
        translation: "<tag title=“name”>“译文”",
        preserve_rule: rule,
        target_language: "ZH",
      }),
    ).toBe("<tag title=“name”>「译文」");
  });

  it("源文混用等价标点时保持译文", () => {
    const translation = "A：B：C";
    expect(
      restore({
        restoration_text: "A:B：C",
        model_text: "A:B：C",
        translation,
        source_language: "EN",
        target_language: "EN",
      }),
    ).toBe(translation);
  });

  it("恢复结果保持幂等", () => {
    const rule = create_rule(["<[^>]+>"]);
    const args = {
      restoration_text: String.raw`「①\\n」<x>`,
      model_text: String.raw`「①\\n」<x>`,
      translation: String.raw`“1\n”<extra><x>`,
      preserve_rule: rule,
      source_language: "JA" as const,
      target_language: "ZH" as const,
    };
    const restored = restore(args);

    expect(restore({ ...args, translation: restored })).toBe(restored);
  });
});

function restore(
  overrides: Partial<Parameters<typeof restore_translation_line>[0]> &
    Pick<
      Parameters<typeof restore_translation_line>[0],
      "restoration_text" | "model_text" | "translation"
    >,
): string {
  return restore_translation_line({
    preserve_rule: null,
    source_language: "JA",
    target_language: "ZH",
    ...overrides,
  });
}

function create_rule(sources: string[]): TextPreserveRule {
  const rule = build_text_preserve_rule({
    mode: "CUSTOM",
    text_type: "NONE",
    entries: sources.map((src) => ({ src, info: "" })),
  });
  if (rule === null) throw new Error("测试保护规则构造失败。");
  return rule;
}
