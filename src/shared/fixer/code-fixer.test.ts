import { describe, expect, it } from "vitest";

import { CodeFixer } from "./code-fixer";

describe("CodeFixer", () => {
  const code_rule = /<[^>]+>/gu;

  it("删除译文中夹在源文保护段之间的多余代码段", () => {
    const src = "A<1>B<2>C";
    const dst = "A<1>B<x><2>C";

    expect(CodeFixer.fix(src, dst, code_rule)).toBe("A<1>B<2>C");
  });

  it("删除最后一个匹配项前后的多余代码段", () => {
    const src = "A<1>B<3>C";
    const dst = "A<1>B<x><3><y>C";

    expect(CodeFixer.fix(src, dst, code_rule)).toBe("A<1>B<3>C");
  });

  it("源文没有保护段时删除译文所有保护段", () => {
    const src = "ABC";
    const dst = "A<1>B<2>C";

    expect(CodeFixer.fix(src, dst, code_rule)).toBe("ABC");
  });

  it("源文和译文保护段序列一致时保持译文不变", () => {
    const src = "A<1>B";
    const dst = "X<1>Y";

    expect(CodeFixer.fix(src, dst, code_rule)).toBe(dst);
  });

  it("源文和译文保护段数量相等但内容不同时保持译文不变", () => {
    const src = "A<1>B<2>C";
    const dst = "A<1>B<x>C";

    expect(CodeFixer.fix(src, dst, code_rule)).toBe(dst);
  });

  it("译文保护段少于源文时保持译文不变", () => {
    const src = "A<1>B<2>C";
    const dst = "A<1>BC";

    expect(CodeFixer.fix(src, dst, code_rule)).toBe(dst);
  });

  it("规则命中空白时保留空白并只删除多余非空保护段", () => {
    const whitespace_rule = /\s+|<[^>]+>/gu;
    const src = "A<1> B<2> C";
    const dst = "A<1>  B<x><2> C";

    expect(CodeFixer.fix(src, dst, whitespace_rule)).toBe("A<1>  B<2> C");
  });

  it("没有保护规则时保持译文不变", () => {
    const src = "A<1>B";
    const dst = "A<1><x>B";

    expect(CodeFixer.fix(src, dst, null)).toBe(dst);
  });

  it("源文保护段不是译文保护段有序子集时保持译文不变", () => {
    const src = "A<1>B<2>C";
    const dst = "A<1><x>B<3>C";

    expect(CodeFixer.fix(src, dst, code_rule)).toBe(dst);
  });
});
