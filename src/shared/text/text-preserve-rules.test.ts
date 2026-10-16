import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  TextPreserveRule,
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

  it("smart 模式按文本类型使用共享预置规则", () => {
    const rule = build_text_preserve_rule({
      mode: "smart",
      text_type: "WOLF",
      entries: [],
    });

    expect(rule.collect("@12こんにちは")).toContain("@12");
  });

  it.each([
    { text: "%sHP、%02dDamage", segments: ["%s", "%02d"] }, // 格式后紧邻正文
    { text: "%.*f と %1$*2$s", segments: ["%.*f", "%1$*2$s"] }, // 动态宽度与精度
    {
      text: "%s %02d %1$s %<name>s %{count} %1が%2 %%",
      segments: ["%s", "%02d", "%1$s", "%<name>s", "%{count}", "%1", "%2", "%%"],
    }, // 既有格式与 MV/MZ 占位符
    {
      text: String.raw`\C[2]所持金\.\G`,
      segments: [String.raw`\C[2]`, String.raw`\.`, String.raw`\G`],
    }, // 相邻控制符与末尾单字母控制符
    { text: String.raw`100%です、50% off、C:\\`, segments: [] }, // 普通百分号与字面反斜杠
  ])("RPG Maker 智能规则完整保护控制符与格式占位符：$text", ({ text, segments }) => {
    const rule = build_text_preserve_rule({ mode: "smart", text_type: "RPGMAKER", entries: [] });
    expect(collect_non_blank_text_preserve_segments(text, rule)).toEqual(segments);
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

  it("移除保护内容时保留词边界和换行", () => {
    const rule = new TextPreserveRule([entry("<[^>]+>"), entry("\\s")]);
    const analysis = rule.analyze("one<tag>two\nthree <A\nB>four");
    expect(analysis.unpreserved_text.split("\n").map((line) => line.trim().split(/\s+/u))).toEqual([
      ["one", "two"],
      ["three"],
      ["four"],
    ]);
    expect(analysis.segments).toEqual(["<tag>", "\n", " ", "<A\nB>"]);
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

/** 为测试表达式补齐规则条目的说明字段。 */
function entry(src: string): { src: string; info: string } {
  return { src, info: "" };
}
