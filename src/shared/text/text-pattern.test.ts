import { describe, expect, it } from "vitest";

import {
  compile_text_pattern,
  create_text_keyword_matcher,
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
