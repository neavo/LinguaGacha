import { describe, expect, it } from "vitest";

import { PunctuationFixer } from "./punctuation-fixer";

describe("PunctuationFixer", () => {
  it.each([
    ["源文日式钩括号恢复到译文边界", "「你好」", '"你好"', "JA", "JA", "「你好」"],
    ["CJK 目标把源文弯引号归一为日式钩括号", "“你好”", '"你好"', "ZH", "ZH", "「你好」"],
    ["CJK 目标把译文弯引号归一为日式钩括号", "「hello」", "“hello”", "JA", "ZH", "「hello」"],
  ] as const)("%s", (_name, src, dst, source_language, target_language, expected) => {
    expect(PunctuationFixer.fix(src, dst, source_language, target_language)).toBe(expected);
  });

  it.each([
    ["非 CJK 译为 CJK 时保留译文全角标点", "A:B", "A：B", "EN", "ZH", "A：B"],
    ["非 CJK 互译时恢复源文半角标点", "A:B", "A：B", "EN", "EN", "A:B"],
    ["CJK 译为非 CJK 时恢复源文全角标点", "A：B", "A:B", "JA", "EN", "A：B"],
  ] as const)("%s", (_name, src, dst, source_language, target_language, expected) => {
    expect(PunctuationFixer.fix(src, dst, source_language, target_language)).toBe(expected);
  });

  it("源文没有引号时保留译文边界引号", () => {
    const src = "你好";
    const dst = '"你好"';

    expect(PunctuationFixer.fix(src, dst, "ZH", "ZH")).toBe('"你好"');
  });
});
