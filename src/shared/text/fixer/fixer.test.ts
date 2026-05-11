import { describe, expect, it } from "vitest";

import { CodeFixer } from "./code-fixer";
import { EscapeFixer } from "./escape-fixer";
import { HangeulFixer } from "./hangeul-fixer";
import { KanaFixer } from "./kana-fixer";
import { NumberFixer } from "./number-fixer";
import { PunctuationFixer } from "./punctuation-fixer";
import { RubyCleaner } from "./ruby-cleaner";

describe("文本修复器", () => {
  it("清理 ruby 标记时区分保守规则和格式例外", () => {
    expect(RubyCleaner.clean("\\r[漢字,かんじ]", "WOLF")).toBe("漢字");
    expect(RubyCleaner.clean("(漢字/かんじ)", "MD")).toBe("漢字");
    expect(RubyCleaner.clean("(漢字/かんじ)", "WOLF")).toBe("(漢字/かんじ)");
  });

  it("EPUB 有块级 ruby 候选且启用时优先使用候选正文", () => {
    expect(
      RubyCleaner.clean_item_src(
        {
          src: "宝條\n直希",
          extra_field: {
            epub: {
              ruby_clean_candidate: {
                cleaned_src: "宝條直希",
              },
            },
          },
        },
        true,
      ),
    ).toBe("宝條直希");
    expect(RubyCleaner.clean_item_src({ src: "宝條\n直希" }, false)).toBe("宝條\n直希");
  });

  it("按源文保护段删除译文里多出来的代码段", () => {
    const rule = /\\n\[\d+\]/gu;

    expect(CodeFixer.fix("\\n[1]正文", "\\n[9]\\n[1]译文", rule)).toBe("\\n[1]译文");
  });

  it("恢复转义符、圆圈数字和全角标点的可逆变化", () => {
    expect(EscapeFixer.fix("\\\\路径", "\\路径")).toBe("\\\\路径");
    expect(NumberFixer.fix("第①章", "第1章")).toBe("第①章");
    expect(PunctuationFixer.fix("「你好！」", '"你好!"', "JA", "ZH")).toBe("「你好！」");
  });

  it("移除孤立假名和谚文拟声残留", () => {
    expect(KanaFixer.fix("你好っ")).toBe("你好");
    expect(KanaFixer.fix("まっすぐ")).toBe("まっすぐ");
    expect(HangeulFixer.fix("你好뿅")).toBe("你好");
    expect(HangeulFixer.fix("아뿅")).toBe("아뿅");
  });
});
