import { describe, expect, it } from "vitest";

import {
  has_target_language_character,
  should_skip_by_language_filter,
} from "@/project/rules/language-filter";
import {
  ALL_LANGUAGE_CODE,
  LANGUAGE_DEFINITIONS,
  SOURCE_TARGET_LANGUAGE_CODES,
  normalize_language_code,
} from "@/project/rules/languages";
import { is_punctuation_character } from "@/project/rules/punctuation";
import { should_skip_by_rule_filter } from "@/project/rules/rule-filter";

describe("project rules", () => {
  it("以规则模块作为前端语言代码清单事实源", () => {
    expect(Object.keys(LANGUAGE_DEFINITIONS).sort()).toEqual(
      [ALL_LANGUAGE_CODE, ...SOURCE_TARGET_LANGUAGE_CODES].sort(),
    );
  });

  it("按 Python BaseLanguage 口径归一化前端预过滤语言", () => {
    expect(normalize_language_code("fr")).toBe("FR");
    expect(normalize_language_code("VI")).toBe("VI");
    expect(normalize_language_code("unknown")).toBeNull();
  });

  it("按目标语言字符判断是否需要语言跳过", () => {
    expect(should_skip_by_language_filter("plain english line", "ALL")).toBe(false);
    expect(should_skip_by_language_filter("plain english line", "JA")).toBe(true);
    expect(should_skip_by_language_filter("plain english line", "EN")).toBe(false);
    expect(should_skip_by_language_filter("Привет", "RU")).toBe(false);
    expect(should_skip_by_language_filter("مرحبا", "AR")).toBe(false);
    expect(should_skip_by_language_filter("ภาษาไทย", "TH")).toBe(false);
    expect(should_skip_by_language_filter("français", "FR")).toBe(false);
  });

  it("未知语言不由前端主动跳过", () => {
    expect(has_target_language_character("plain english line", "XX")).toBe(true);
    expect(should_skip_by_language_filter("plain english line", "XX")).toBe(false);
  });

  it("按 Python TextHelper 口径识别标点", () => {
    expect(is_punctuation_character("，")).toBe(true);
    expect(is_punctuation_character("!")).toBe(true);
    expect(is_punctuation_character("·")).toBe(true);
    expect(is_punctuation_character("¡")).toBe(false);
  });

  it("按规则前缀、后缀、正则和数字标点行判断跳过", () => {
    expect(should_skip_by_rule_filter("mapdata/title.png")).toBe(true);
    expect(should_skip_by_rule_filter("voice.ogg")).toBe(true);
    expect(should_skip_by_rule_filter("EV001")).toBe(true);
    expect(should_skip_by_rule_filter("123!!!")).toBe(true);
    expect(should_skip_by_rule_filter("123!!!\nplain text")).toBe(false);
  });
});
