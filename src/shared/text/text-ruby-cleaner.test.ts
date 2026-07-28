import { describe, expect, it } from "vitest";

import { TextRubyCleaner } from "./text-ruby-cleaner";

describe("TextRubyCleaner", () => {
  it("清理 WOLF 反斜杠 ruby 标记并保留正文", () => {
    expect(TextRubyCleaner.clean("\\r[漢字,かんじ]", "WOLF")).toBe("漢字");
  });

  it("普通文本清理括号 ruby 标记并保留正文", () => {
    expect(TextRubyCleaner.clean("(漢字/かんじ)", "MD")).toBe("漢字");
  });

  it("WOLF 文本保留可能属于控制语法的括号内容", () => {
    expect(TextRubyCleaner.clean("(漢字/かんじ)", "WOLF")).toBe("(漢字/かんじ)");
  });
});
