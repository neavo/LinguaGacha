import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  are_text_preserve_segments_equal,
  build_text_preserve_rule,
  collect_non_blank_text_preserve_segments,
} from "./text-preserve-rules";

type TextPreservePresetEntry = {
  src?: unknown;
};

describe("text-preserve-rules", () => {
  it("内置文本保护预设只包含可编译的 JS Unicode 正则", () => {
    const preset_dir = path.join(process.cwd(), "resource", "text_preserve", "preset");
    const preset_files = fs.readdirSync(preset_dir).filter((file_name) => {
      return file_name.endsWith(".json");
    });

    for (const file_name of preset_files) {
      const parsed_entries = JSON.parse(
        fs.readFileSync(path.join(preset_dir, file_name), "utf-8"),
      ) as unknown;
      expect(Array.isArray(parsed_entries), file_name).toBe(true);

      const entries = Array.isArray(parsed_entries)
        ? (parsed_entries as TextPreservePresetEntry[])
        : [];
      entries.forEach((entry, index) => {
        expect(typeof entry.src, `${file_name}[${index}].src`).toBe("string");
        const src = typeof entry.src === "string" ? entry.src : "";
        expect(src.trim(), `${file_name}[${index}].src`).not.toBe("");
        expect(src, `${file_name}[${index}].src`).not.toMatch(/\\U[0-9A-Fa-f]{8}/u);
        expect(() => new RegExp(src, "iu"), `${file_name}[${index}].src`).not.toThrow();
      });
    }
  });

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

  it("custom 模式只保留非空且可编译的 src 字段", () => {
    const rule = build_text_preserve_rule({
      mode: "CUSTOM",
      text_type: "NONE",
      entries: [
        { src: "  <A>  " },
        { src: "" },
        { src: "   " },
        { src: 123 },
        { dst: "missing" },
        { src: "[" },
        { src: "<B>" },
      ],
      kind: "sample",
    });

    expect(rule?.collect("x<A>y<B>z")).toEqual(["<A>", "<B>"]);
  });

  it("custom 模式没有可编译规则时返回 null", () => {
    expect(
      build_text_preserve_rule({
        mode: "CUSTOM",
        text_type: "NONE",
        entries: [{ src: "[" }],
        kind: "sample",
      }),
    ).toBeNull();
  });

  it("custom 模式不再接受 \\UXXXXXXXX 转义", () => {
    const rule = build_text_preserve_rule({
      mode: "CUSTOM",
      text_type: "NONE",
      entries: [{ src: "\\U0001F600" }],
      kind: "sample",
    });

    expect(rule).toBeNull();
  });

  it("custom 模式支持 Unicode 属性转义", () => {
    const rule = build_text_preserve_rule({
      mode: "CUSTOM",
      text_type: "NONE",
      entries: [{ src: "\\p{Script=Han}+" }],
      kind: "sample",
    });

    expect(rule?.collect("Alice 与 Bob")).toEqual(["与"]);
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

  it("RenPy 智能保护段会用共享 CJK Script 规则排除正文", () => {
    const rule = build_text_preserve_rule({
      mode: "smart",
      text_type: "RENPY",
      entries: [],
      kind: "sample",
    });

    expect(rule?.test("{player_name}")).toBe(true);
    expect(rule?.test("{名前}")).toBe(false);
  });

  it("收集保护段时会忽略只包含空白的命中", () => {
    const rule = build_text_preserve_rule({
      mode: "CUSTOM",
      text_type: "NONE",
      entries: [{ src: "\\s+" }, { src: "\\[[^\\]]+\\]" }],
      kind: "sample",
    });

    expect(rule).not.toBeNull();
    expect(
      rule === null ? [] : collect_non_blank_text_preserve_segments(" \t[A]\n ", rule),
    ).toEqual(["[A]"]);
  });

  it("比较保护段时忽略命中内部空白并按序列判断", () => {
    const rule = build_text_preserve_rule({
      mode: "CUSTOM",
      text_type: "NONE",
      entries: [{ src: "\\[[^\\]]+\\]" }],
      kind: "sample",
    });

    expect(rule).not.toBeNull();
    expect(
      rule === null ? false : are_text_preserve_segments_equal("[a b] text", "[ab] text", rule),
    ).toBe(true);
    expect(
      rule === null ? false : are_text_preserve_segments_equal("[A] body", "[B] body", rule),
    ).toBe(false);
    expect(
      rule === null ? false : are_text_preserve_segments_equal("x[A]y[B]", "[A][B]xy", rule),
    ).toBe(true);
  });
});
