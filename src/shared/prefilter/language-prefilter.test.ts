import { describe, expect, it } from "vitest";

import {
  has_prefilter_language_character,
  should_skip_by_language_prefilter,
} from "./language-prefilter";

describe("language-prefilter", () => {
  it("ALL 不由预过滤主动跳过", () => {
    expect(has_prefilter_language_character("plain english line", "ALL")).toBe(true);
    expect(should_skip_by_language_prefilter("plain english line", "ALL")).toBe(false);
  });

  it("未知语言会显式报错，避免损坏配置静默漏过滤", () => {
    expect(() => has_prefilter_language_character("plain english line", "XX")).toThrow(
      "未知源语言代码：XX",
    );
    expect(() => should_skip_by_language_prefilter("plain english line", "XX")).toThrow(
      "未知源语言代码：XX",
    );
  });

  it("中文源语言包含 CJK 字符则不过滤，否则过滤", () => {
    expect(should_skip_by_language_prefilter("你好世界", "ZH")).toBe(false);
    expect(should_skip_by_language_prefilter("Hello 你好", "ZH")).toBe(false);
    expect(should_skip_by_language_prefilter("Hello World", "ZH")).toBe(true);
    expect(should_skip_by_language_prefilter("12345", "ZH")).toBe(true);
  });

  it("英文源语言包含拉丁字符则不过滤，否则过滤", () => {
    expect(should_skip_by_language_prefilter("Hello World", "EN")).toBe(false);
    expect(should_skip_by_language_prefilter("你好 Hello", "EN")).toBe(false);
    expect(should_skip_by_language_prefilter("你好世界", "EN")).toBe(true);
    expect(should_skip_by_language_prefilter("12345", "EN")).toBe(true);
  });

  it.each([
    ["JA", "こんにちは"],
    ["KO", "안녕하세요"],
    ["RU", "Привет"],
    ["AR", "مرحبا"],
    ["DE", "Straße"],
    ["FR", "Bonjour"],
    ["PL", "Zażółć gęślą jaźń"],
    ["ES", "Hola"],
    ["IT", "Città"],
    ["PT", "Olá"],
    ["HU", "Árvíztűrő"],
    ["TR", "İstanbul"],
    ["TH", "สวัสดี"],
    ["ID", "Bahasa"],
    ["VI", "Xin chào"],
  ] as const)("支持动态语言代码 %s", (source_language, text) => {
    expect(should_skip_by_language_prefilter(text, source_language)).toBe(false);
  });

  it.each([
    ["JA", "12345"],
    ["KO", "12345"],
    ["RU", "12345"],
    ["AR", "12345"],
  ] as const)("没有目标文字时过滤动态语言 %s", (source_language, text) => {
    expect(should_skip_by_language_prefilter(text, source_language)).toBe(true);
  });

  it("普通字符串语言码按历史大小写归一规则参与过滤", () => {
    expect(should_skip_by_language_prefilter("plain english line", "JA")).toBe(true);
    expect(should_skip_by_language_prefilter("plain english line", "EN")).toBe(false);
    expect(should_skip_by_language_prefilter("你好世界", "zh")).toBe(false);
    expect(should_skip_by_language_prefilter("Привет", "RU")).toBe(false);
    expect(should_skip_by_language_prefilter("مرحبا", "AR")).toBe(false);
    expect(should_skip_by_language_prefilter("ภาษาไทย", "TH")).toBe(false);
    expect(should_skip_by_language_prefilter("français", "FR")).toBe(false);
  });
});
