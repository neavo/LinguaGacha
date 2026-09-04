import { describe, expect, it } from "vitest";

import { TextRubyCleaner } from "./text-ruby-cleaner";

describe("TextRubyCleaner", () => {
  it.each([
    ["WOLF 反斜杠 ruby", "\\r[漢字,かんじ]", "WOLF", "漢字"],
    ["普通文本括号 ruby", "(漢字/かんじ)", "MD", "漢字"],
    ["WOLF 控制语法括号", "(漢字/かんじ)", "WOLF", "(漢字/かんじ)"],
  ] as const)("按格式处理 %s", (_case, text, file_type, expected) => {
    expect(TextRubyCleaner.clean(text, file_type)).toBe(expected);
  });
});
