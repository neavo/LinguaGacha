import { describe, expect, it } from "vitest";

import type { TextReplacementEntry } from "../../domain/quality";
import { apply_text_replacements, compile_text_replacements } from "./text-replacement-rules";

describe("apply_text_replacements", () => {
  it("普通替换支持大小写不敏感匹配并按字面量写入替换文本", () => {
    expect(
      apply("abc AbC", [
        {
          src: "ABC",
          dst: "\\c",
          regex: false,
          case_sensitive: false,
        },
      ]),
    ).toBe("\\c \\c");
  });

  it.each([
    ["忽略大小写", "ABbb aB", "ab+", false, "x x"],
    ["区分大小写", "aa AA A", "A+", true, "aa x x"],
  ] as const)("正则替换%s", (_name, text, src, case_sensitive, expected) => {
    expect(
      apply(text, [
        {
          src,
          dst: "x",
          regex: true,
          case_sensitive,
        },
      ]),
    ).toBe(expected);
  });

  it("正则替换使用规则型反斜杠捕获并保留美元符号字面量", () => {
    expect(
      apply("Name: Alice", [
        {
          src: "Name: (.+)",
          dst: "\\1 / $1",
          regex: true,
          case_sensitive: true,
        },
      ]),
    ).toBe("Alice / $1");
  });

  it("空 dst 删除命中内容，空 src 在编译边界失败", () => {
    expect(apply("ABC", [{ src: "ABC", dst: "", regex: false, case_sensitive: true }])).toBe("");
    expect(() =>
      compile_text_replacements([{ src: "", dst: "ignored", regex: false, case_sensitive: true }]),
    ).toThrow("替换规则 src 不能为空");
  });

  it("普通大小写不敏感替换会按字面量转义正则特殊字符", () => {
    expect(
      apply("A.B aXb", [
        {
          src: "a.b",
          dst: "x",
          regex: false,
          case_sensitive: false,
        },
      ]),
    ).toBe("x aXb");
  });

  it("规则按列表顺序执行且复用 Unicode 字面量语义", () => {
    expect(
      apply("Straße aaa", [
        { src: "STRASSE", dst: "road", regex: false, case_sensitive: false },
        { src: "aa", dst: "x", regex: false, case_sensitive: true },
        { src: "road", dst: "路", regex: false, case_sensitive: true },
      ]),
    ).toBe("路 xa");
  });

  it("大小写敏感字面量仍执行 NFKC，正则保持原生文本语义", () => {
    expect(apply("ＪＫ ｊｋ", [{ src: "JK", dst: "X", regex: false, case_sensitive: true }])).toBe(
      "X ｊｋ",
    );
    expect(apply("ＪＫ", [{ src: "JK", dst: "X", regex: true, case_sensitive: true }])).toBe(
      "ＪＫ",
    );
  });
});

function apply(text: string, entries: TextReplacementEntry[]): string {
  return apply_text_replacements(text, compile_text_replacements(entries));
}
