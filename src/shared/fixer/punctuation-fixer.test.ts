import { describe, expect, it } from "vitest";

import { PunctuationFixer } from "./punctuation-fixer";

describe("PunctuationFixer", () => {
  it("按源文边界恢复日式钩括号", () => {
    const src = "「你好」";
    const dst = '"你好"';

    expect(PunctuationFixer.fix(src, dst, "JA", "JA")).toBe("「你好」");
  });

  it("非 CJK 到 CJK 时只应用规则 A", () => {
    const src = "A:B";
    const dst = "A：B";

    expect(PunctuationFixer.fix(src, dst, "EN", "ZH")).toBe("A：B");
  });

  it("非 CJK 到非 CJK 时应用规则 B", () => {
    const src = "A:B";
    const dst = "A：B";

    expect(PunctuationFixer.fix(src, dst, "EN", "EN")).toBe("A:B");
  });

  it("CJK 到非 CJK 时应用规则 A 和规则 B", () => {
    const src = "A：B";
    const dst = "A:B";

    expect(PunctuationFixer.fix(src, dst, "JA", "EN")).toBe("A：B");
  });

  it("CJK 目标语言会把中文弯引号归一成日式钩括号", () => {
    const src = "“你好”";
    const dst = '"你好"';

    expect(PunctuationFixer.fix(src, dst, "ZH", "ZH")).toBe("「你好」");
  });

  it("源文没有引号时保留译文边界引号", () => {
    const src = "你好";
    const dst = '"你好"';

    expect(PunctuationFixer.fix(src, dst, "ZH", "ZH")).toBe('"你好"');
  });

  it("CJK 目标语言强制把弯引号转成钩括号", () => {
    const src = "\u300chello\u300d";
    const dst = "\u201chello\u201d";

    expect(PunctuationFixer.fix(src, dst, "JA", "ZH")).toBe("\u300chello\u300d");
  });
});
