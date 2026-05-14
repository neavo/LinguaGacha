import { describe, expect, it } from "vitest";

import { HangeulFixer } from "./hangeul-fixer";

describe("HangeulFixer", () => {
  it.each([
    ["가뿅나", "가뿅나"],
    ["뿅가", "뿅가"],
  ] as const)("拟声谚文贴近其它谚文时保留：%s", (text, expected) => {
    expect(HangeulFixer.fix(text)).toBe(expected);
  });

  it.each([
    ["A뿅B", "AB"],
    ["A뿅", "A"],
  ] as const)("拟声谚文没有谚文邻居时移除：%s", (text, expected) => {
    expect(HangeulFixer.fix(text)).toBe(expected);
  });

  it("普通韩文文本保持不变", () => {
    expect(HangeulFixer.fix("안녕하세요")).toBe("안녕하세요");
  });
});
