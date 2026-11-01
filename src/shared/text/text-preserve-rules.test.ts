import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import renpy_entries from "../../../builtin/text_preserve/preset/renpy.json";

import {
  TextPreserveRule,
  build_text_preserve_rule,
  collect_non_blank_text_preserve_segments,
} from "./text-preserve-rules";

type TextPreservePresetEntry = {
  src?: unknown;
};

describe("text-preserve-rules", () => {
  it("Godot 格式保护 printf、命名占位符与 BBCode", () => {
    const rule = build_text_preserve_rule({ mode: "SMART", text_type: "GODOT", entries: [] });
    const text = "[b]玩家 {name}：%s %.2f %-5d[/b]";
    expect(rule.collect(text).filter((segment) => segment.trim())).toEqual([
      "[b]",
      "{name}",
      "%s",
      "%.2f",
      "%-5d",
      "[/b]",
    ]);
    expect(rule.analyze(text).unpreserved_text).toContain("玩家");
  });
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

  it.each([
    { text: "{{ [[", segments: ["{{", "[["], body: "" },
    { text: "{#menu}{#菜单}", segments: ["{#menu}", "{#菜单}"], body: "" },
    {
      text: "{b}{/b}{a=[url]}{=style}{0}",
      segments: ["{b}", "{/b}", "{a=[url]}", "{=style}", "{0}"],
      body: "",
    },
    { text: "{普通正文}{font=中文.ttf}", segments: [], body: "{普通正文}{font=中文.ttf}" },
    ...[
      "[a + b]",
      "[n:.2f]",
      "[a[0][1]]",
      "[fn()[0]]",
      "[fn([1, 2])]",
      '[items[0].get("]")]',
      '["text]more"]',
      '[obj.fn("日本")]',
      "[obj.fn('日本')]",
      String.raw`[fn("a\"b]c")]`,
      String.raw`[fn('a\'b]c')]`,
    ].map((text) => ({ text, segments: [text], body: "" })),
    ...["[名前]", "[name は誰]", "[fn(日本)]", "[a[日本]]"].map((text) => ({
      text,
      segments: [],
      body: text,
    })),
    { text: "[name] Hello [other]", segments: ["[name]", "[other]"], body: "Hello" },
    { text: "[a[b[0]]]", segments: ["[b[0]]"], body: "[a ]" },
    { text: "[fn([[1]])]", segments: ["[["], body: "[fn( 1]])]" },
    { text: "[a\nb] {a\rb}", segments: [], body: "[a b] {a b}" },
    { text: '[fn("a\nb")]', segments: [], body: '[fn("a b")]' },
    {
      text: "%s %(name)s %02d %.2f %.*f %%",
      segments: ["%s", "%(name)s", "%02d", "%.2f", "%.*f", "%%"],
      body: "",
    },
    { text: "%(name\n)s", segments: [], body: "%(name )s" },
  ])("Ren’Py 预设按字符边界保护，smart 与 custom 等价：$text", ({ text, segments, body }) => {
    const smart = build_text_preserve_rule({
      mode: "smart",
      text_type: "RENPY",
      entries: [],
    });
    const custom = build_text_preserve_rule({
      mode: "custom",
      text_type: "RENPY",
      entries: renpy_entries,
    });
    const analysis = smart.analyze(text);
    expect(analysis).toEqual(custom.analyze(text));
    expect(analysis.segments.filter((segment) => segment.trim())).toEqual(segments);
    expect(analysis.unpreserved_text.replace(/\s+/gu, " ").trim()).toBe(body);
  });

  it("忽略空命中，重叠候选按起点及同起点条目顺序裁决", () => {
    const rule = new TextPreserveRule([entry(""), entry("bc"), entry("ab"), entry("abc")]);
    expect(rule.collect("abc")).toEqual(["ab"]);
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
