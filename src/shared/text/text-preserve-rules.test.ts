import { describe, expect, it } from "vitest";

import {
  are_text_preserve_segments_equal,
  build_text_preserve_rule,
  collect_non_blank_text_preserve_segments,
  resolve_text_preserve_patterns,
} from "./text-preserve-rules";

describe("text-preserve-rules", () => {
  it("off 模式不会返回任何保护规则", () => {
    expect(
      build_text_preserve_rule({
        mode: "OFF",
        text_type: "NONE",
        entries: [{ src: "[A]" }],
        kind: "check",
      }),
    ).toBeNull();
  });

  it("custom 模式只保留非空 src 字段", () => {
    expect(
      resolve_text_preserve_patterns({
        mode: "CUSTOM",
        text_type: "NONE",
        entries: [
          { src: "  [A]  " },
          { src: "" },
          { src: "   " },
          { src: 123 },
          { dst: "missing" },
          { src: "[B]" },
        ],
      }),
    ).toEqual(["[A]", "[B]"]);
  });

  it("prefix 和 suffix 规则只匹配行首或行尾保护段", () => {
    const prefix = build_text_preserve_rule({
      mode: "CUSTOM",
      text_type: "NONE",
      entries: [{ src: "ab" }],
      kind: "prefix",
    });
    const suffix = build_text_preserve_rule({
      mode: "CUSTOM",
      text_type: "NONE",
      entries: [{ src: "ab" }],
      kind: "suffix",
    });

    expect(prefix?.test("abz")).toBe(true);
    expect(prefix?.test("zab")).toBe(false);
    expect(suffix?.test("zab")).toBe(true);
    expect(suffix?.test("abz")).toBe(false);
  });

  it("smart 模式按文本类型使用共享预置规则", () => {
    const rule = build_text_preserve_rule({
      mode: "smart",
      text_type: "WOLF",
      entries: [],
      kind: "sample",
    });

    expect(rule?.test("@12こんにちは")).toBe(true);
  });

  it("收集保护段时会忽略只包含空白的命中", () => {
    const rule = /\s+|\[[^\]]+\]/giu;

    expect(collect_non_blank_text_preserve_segments(" \t[A]\n ", rule)).toEqual(["[A]"]);
  });

  it("比较保护段时忽略命中内部空白并按序列判断", () => {
    const rule = /\[[^\]]+\]/giu;

    expect(are_text_preserve_segments_equal("[a b] text", "[ab] text", rule)).toBe(true);
    expect(are_text_preserve_segments_equal("[A] body", "[B] body", rule)).toBe(false);
    expect(are_text_preserve_segments_equal("x[A]y[B]", "[A][B]xy", rule)).toBe(true);
  });
});
