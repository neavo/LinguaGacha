import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  build_text_preserve_rule,
  collect_non_blank_text_preserve_segments,
} from "./text-preserve-rules";

type TextPreservePresetEntry = {
  src?: unknown;
};

describe("text-preserve-rules", () => {
  it("内置文本保护规则只包含可编译的 JS Unicode 正则", () => {
    const preset_dir = path.join(process.cwd(), "builtin", "text_preserve", "preset");
    const rule_files = fs
      .readdirSync(preset_dir)
      .filter((file_name) => file_name.endsWith(".json"))
      .map((file_name) => path.join(preset_dir, file_name));

    for (const file_path of rule_files) {
      const parsed_entries = JSON.parse(fs.readFileSync(file_path, "utf-8")) as unknown;
      const file_name = path.basename(file_path);
      expect(Array.isArray(parsed_entries), file_name).toBe(true);

      const entries = Array.isArray(parsed_entries)
        ? (parsed_entries as TextPreservePresetEntry[])
        : [];
      entries.forEach((entry, index) => {
        expect(typeof entry.src, `${file_name}[${index}].src`).toBe("string");
        const src = typeof entry.src === "string" ? entry.src : "";
        expect(src.trim(), `${file_name}[${index}].src`).not.toBe("");
        expect(() => new RegExp(src, "iu"), `${file_name}[${index}].src`).not.toThrow();
      });
    }
  });

  it.each(["OFF", "SMART", "CUSTOM"])("%s 模式始终启用基础保护规则", (mode) => {
    const rule = build_text_preserve_rule({
      mode,
      text_type: "NONE",
      entries: [entry("[a-z-]+")],
    });

    expect(rule.collect("<br> lg-uri/12正文")).toEqual(["<br>", " ", "lg-uri/12"]);
  });

  it("custom 模式按条目顺序编译并裁决重叠候选", () => {
    const rule = build_text_preserve_rule({
      mode: "CUSTOM",
      text_type: "NONE",
      entries: [entry("<A>"), entry("<[^>]+>")],
    });

    expect(rule.collect("x<A>y<B>z")).toEqual(["<A>", "<B>"]);
  });

  it("custom 模式拒绝无效 JavaScript 正则", () => {
    expect(() =>
      build_text_preserve_rule({
        mode: "CUSTOM",
        text_type: "NONE",
        entries: [entry("(")],
      }),
    ).toThrow();
  });

  it("custom 模式支持 Unicode 属性转义", () => {
    const rule = build_text_preserve_rule({
      mode: "CUSTOM",
      text_type: "NONE",
      entries: [entry("\\p{Script=Han}+")],
    });

    expect(collect_non_blank_text_preserve_segments("Alice 与 Bob", rule)).toEqual(["与"]);
  });

  it("prefix 和 suffix 规则只匹配行首或行尾保护段", () => {
    const rule = build_text_preserve_rule({
      mode: "CUSTOM",
      text_type: "NONE",
      entries: [entry("ab")],
    });

    expect(rule.extract_prefix("ababz")).toEqual({ text: "z", segments: ["ab", "ab"] });
    expect(rule.extract_prefix("zab")).toEqual({ text: "zab", segments: [] });
    expect(rule.extract_suffix("zabab")).toEqual({ text: "z", segments: ["ab", "ab"] });
    expect(rule.extract_suffix("abz")).toEqual({ text: "abz", segments: [] });
  });

  it("smart 模式按文本类型使用共享预置规则", () => {
    const rule = build_text_preserve_rule({
      mode: "smart",
      text_type: "WOLF",
      entries: [],
    });

    expect(rule.collect("@12こんにちは")).toContain("@12");
  });

  it("RenPy 智能规则只保护不含 CJK 正文的控制段", () => {
    const rule = build_text_preserve_rule({
      mode: "smart",
      text_type: "RENPY",
      entries: [],
    });

    expect(rule.collect("{player_name}")).toEqual(["{player_name}"]);
    expect(rule.collect("{名前}")).toEqual([]);
  });

  it("收集保护段时会忽略只包含空白的命中", () => {
    const rule = build_text_preserve_rule({
      mode: "CUSTOM",
      text_type: "NONE",
      entries: [entry("\\s+"), entry("\\[[^\\]]+\\]")],
    });

    expect(collect_non_blank_text_preserve_segments(" \t[A]\n ", rule)).toEqual(["[A]"]);
  });

  it("只转换未保护文本", () => {
    const rule = build_text_preserve_rule({
      mode: "custom",
      text_type: "NONE",
      entries: [entry("<[^>]+>")],
    });
    expect(rule.transform_unpreserved("a<X>b", (text) => text.toUpperCase())).toBe("A<X>B");
  });
});

function entry(src: string): { src: string; info: string } {
  return { src, info: "" };
}
