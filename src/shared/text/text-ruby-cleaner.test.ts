import { describe, expect, it } from "vitest";

import { TextRubyCleaner } from "./text-ruby-cleaner";

describe("TextRubyCleaner", () => {
  it("始终应用保守 ruby 清理规则", () => {
    expect(TextRubyCleaner.clean("\\r[漢字,かんじ]", "WOLF")).toBe("漢字");
  });

  it("非脚本格式会额外应用激进 ruby 清理规则", () => {
    expect(TextRubyCleaner.clean("(漢字/かんじ)", "MD")).toBe("漢字");
  });

  it("WOLF 格式会跳过括号类激进 ruby 清理规则", () => {
    expect(TextRubyCleaner.clean("(漢字/かんじ)", "WOLF")).toBe("(漢字/かんじ)");
  });
});
