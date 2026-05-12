import { describe, expect, it } from "vitest";

import { KanaFixer } from "./kana-fixer";

describe("KanaFixer", () => {
  it.each([
    ["アっカ", "アっカ"],
    ["っあ", "っあ"],
  ] as const)("小假名贴近其它假名时保留：%s", (text, expected) => {
    expect(KanaFixer.fix(text)).toBe(expected);
  });

  it.each([
    ["AっB", "AB"],
    ["Aっ", "A"],
  ] as const)("小假名没有假名邻居时移除：%s", (text, expected) => {
    expect(KanaFixer.fix(text)).toBe(expected);
  });

  it("普通假名文本保持不变", () => {
    expect(KanaFixer.fix("かなカナ")).toBe("かなカナ");
  });
});
