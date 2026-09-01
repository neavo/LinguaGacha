import { describe, expect, it } from "vitest";

import {
  compile_text_pattern,
  create_text_keyword_matcher,
  create_text_keywords_matcher,
  replace_text_pattern,
} from "./text-pattern";

describe("text-pattern", () => {
  it("交互式正则替换支持 JS 捕获组引用并返回替换次数", () => {
    const pattern = compile_text_pattern({
      source_text: "Name: (.+)",
      mode: "regex",
      global: true,
    });

    expect(pattern).not.toBeNull();
    expect(
      replace_text_pattern({
        text: "Name: Alice\nName: Bob",
        pattern: pattern!,
        replacement_text: "$1",
        replacement_syntax: "javascript",
      }),
    ).toEqual({
      text: "Alice\nBob",
      count: 2,
    });
  });

  it("普通替换按字面量写入美元符号引用", () => {
    const pattern = compile_text_pattern({
      source_text: "Name",
      mode: "literal",
      global: true,
    });

    expect(pattern).not.toBeNull();
    expect(
      replace_text_pattern({
        text: "Name: Alice",
        pattern: pattern!,
        replacement_text: "$&",
        replacement_syntax: "literal",
      }),
    ).toEqual({
      text: "$&: Alice",
      count: 1,
    });
  });

  it("不敏感字面量替换复用 Unicode 折叠并选择左侧非重叠范围", () => {
    const folded = compile_text_pattern({
      source_text: "STRASSE",
      mode: "literal",
      case_sensitive: false,
      global: true,
    });
    const overlapping = compile_text_pattern({
      source_text: "aa",
      mode: "literal",
      case_sensitive: true,
      global: true,
    });

    expect(
      replace_text_pattern({
        text: "Straße",
        pattern: folded!,
        replacement_text: "路",
        replacement_syntax: "literal",
      }),
    ).toEqual({ text: "路", count: 1 });
    expect(
      replace_text_pattern({
        text: "aaa",
        pattern: overlapping!,
        replacement_text: "x",
        replacement_syntax: "literal",
      }),
    ).toEqual({ text: "xa", count: 1 });
  });

  it("字面量模式拒绝正则替换语法", () => {
    const pattern = compile_text_pattern({ source_text: "a", mode: "literal" });
    expect(() =>
      replace_text_pattern({
        text: "a",
        pattern: pattern!,
        replacement_text: "$&",
        replacement_syntax: "javascript",
      }),
    ).toThrow("Literal mode only supports literal replacement syntax.");
  });

  it("规则型正则替换使用反斜杠捕获语法", () => {
    const pattern = compile_text_pattern({
      source_text: "(.+?)=(.+)",
      mode: "regex",
      global: true,
    });

    expect(pattern).not.toBeNull();
    expect(
      replace_text_pattern({
        text: "name=Alice",
        pattern: pattern!,
        replacement_text: "\\2 / $1",
        replacement_syntax: "backslash",
      }),
    ).toEqual({
      text: "Alice / $1",
      count: 1,
    });
  });

  it("关键字匹配器把非法正则转成可展示错误", () => {
    const matcher = create_text_keyword_matcher({
      keyword: "(",
      is_regex: true,
    });

    expect(matcher.invalid_regex_message).not.toBeNull();
    expect(matcher.matches("anything")).toBe(false);
  });

  it("多关键字匹配器按匹配语义去重并保留首次输入顺序", () => {
    const matcher = create_text_keywords_matcher({
      keywords: ["Alice", " alice ", "ＡＬＩＣＥ", "白之城", "白之城", "骑士"],
      is_regex: false,
    });

    expect(matcher.keywords).toEqual(["Alice", "白之城", "骑士"]);
    expect(matcher.match("alice 是白之城骑士")).toEqual(["Alice", "白之城", "骑士"]);
    expect(matcher.matches("alice 是白之城骑士")).toBe(true);
    expect(matcher.matches("无关文本")).toBe(false);
  });

  it("重复正则只编译一次并保留首个表达式", () => {
    const matcher = create_text_keywords_matcher({
      keywords: ["^alpha$", "^alpha$"],
      is_regex: true,
    });

    expect(matcher.keywords).toEqual(["^alpha$"]);
    expect(matcher.match("ALPHA")).toEqual(["^alpha$"]);
  });

  it("正则关键字保留首尾空格作为模式内容", () => {
    const matcher = create_text_keyword_matcher({
      keyword: "^ ",
      is_regex: true,
    });

    expect(matcher.invalid_regex_message).toBeNull();
    expect(matcher.matches(" heading")).toBe(true);
    expect(matcher.matches("heading")).toBe(false);
  });

  it("全空格关键字仍视为无筛选", () => {
    const matcher = create_text_keyword_matcher({
      keyword: "   ",
      is_regex: true,
    });

    expect(matcher.invalid_regex_message).toBeNull();
    expect(matcher.matches("任意文本")).toBe(true);
  });
});
