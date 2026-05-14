import { describe, expect, it } from "vitest";

import { apply_text_replacements } from "./text-replacement-rules";

describe("apply_text_replacements", () => {
  it("普通替换支持大小写不敏感匹配并按字面量写入替换文本", () => {
    expect(
      apply_text_replacements("abc AbC", [
        {
          src: "ABC",
          dst: "\\c",
          regex: false,
          case_sensitive: false,
        },
      ]),
    ).toBe("\\c \\c");
  });

  it("正则替换支持大小写不敏感匹配", () => {
    expect(
      apply_text_replacements("ABbb aB", [
        {
          src: "ab+",
          dst: "x",
          regex: true,
          case_sensitive: false,
        },
      ]),
    ).toBe("x x");
  });

  it("正则替换支持大小写敏感匹配", () => {
    expect(
      apply_text_replacements("aa AA A", [
        {
          src: "A+",
          dst: "x",
          regex: true,
          case_sensitive: true,
        },
      ]),
    ).toBe("aa x x");
  });

  it("替换规则会过滤空模式并把 null 替换值视为空字符串", () => {
    expect(
      apply_text_replacements("ABC", [
        {
          src: "",
          dst: "ignored",
          regex: false,
          case_sensitive: true,
        },
        {
          src: "ABC",
          dst: null,
          regex: false,
          case_sensitive: true,
        },
      ]),
    ).toBe("");
  });

  it("非字符串字段按历史规则转成字符串后参与替换", () => {
    expect(
      apply_text_replacements("123", [
        {
          src: null,
          dst: "ignored",
          regex: false,
          case_sensitive: true,
        },
        {
          src: 123,
          dst: 456,
          regex: false,
          case_sensitive: true,
        },
      ]),
    ).toBe("456");
  });

  it("普通大小写不敏感替换会按字面量转义正则特殊字符", () => {
    expect(
      apply_text_replacements("A.B aXb", [
        {
          src: "a.b",
          dst: "x",
          regex: false,
          case_sensitive: false,
        },
      ]),
    ).toBe("x aXb");
  });
});
