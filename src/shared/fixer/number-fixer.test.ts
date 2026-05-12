import { describe, expect, it } from "vitest";

import { NumberFixer } from "./number-fixer";

describe("NumberFixer", () => {
  it("源文没有圆圈数字时保持译文不变", () => {
    const src = "奖励1";
    const dst = "Reward 1";

    expect(NumberFixer.fix(src, dst)).toBe(dst);
  });

  it("把译文阿拉伯数字恢复为同位置圆圈数字", () => {
    const src = "奖励①";
    const dst = "Reward 1";

    expect(NumberFixer.fix(src, dst)).toBe("Reward ①");
  });

  it("按数字位置恢复多个圆圈数字", () => {
    const src = "①和③";
    const dst = "1和3";

    expect(NumberFixer.fix(src, dst)).toBe("①和③");
  });

  it("源文和译文数字 token 数量不一致时保持译文不变", () => {
    const src = "①2";
    const dst = "1";

    expect(NumberFixer.fix(src, dst)).toBe(dst);
  });

  it("译文圆圈数字多于源文时保持译文不变", () => {
    const src = "①2";
    const dst = "①②";

    expect(NumberFixer.fix(src, dst)).toBe(dst);
  });

  it("只恢复源文中原本是圆圈数字的位置", () => {
    const src = "①2";
    const dst = "1 2";

    expect(NumberFixer.fix(src, dst)).toBe("① 2");
  });

  it.each([
    ["奖励②", "Reward 1"],
    ["①", "㊿"],
    ["奖励①", "Reward 99"],
  ] as const)("圆圈数字无法安全恢复时保持译文不变：%s / %s", (src, dst) => {
    expect(NumberFixer.fix(src, dst)).toBe(dst);
  });
});
