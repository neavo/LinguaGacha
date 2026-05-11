import { describe, expect, it } from "vitest";

import { TextRubyCleaner } from "./text-ruby-cleaner";

describe("TextRubyCleaner", () => {
  it("清理 ruby 标记时区分保守规则和格式例外", () => {
    expect(TextRubyCleaner.clean("\\r[漢字,かんじ]", "WOLF")).toBe("漢字");
    expect(TextRubyCleaner.clean("(漢字/かんじ)", "MD")).toBe("漢字");
    expect(TextRubyCleaner.clean("(漢字/かんじ)", "WOLF")).toBe("(漢字/かんじ)");
  });

  it("EPUB 有块级 ruby 候选且启用时优先使用候选正文", () => {
    expect(
      TextRubyCleaner.clean_item_src(
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
    expect(TextRubyCleaner.clean_item_src({ src: "宝條\n直希" }, false)).toBe("宝條\n直希");
  });
});
