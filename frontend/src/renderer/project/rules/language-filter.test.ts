import { describe, expect, it } from "vitest";

import { has_target_language_character, should_skip_by_language_filter } from "./language-filter";

describe("language-filter", () => {
  it("ALL 和未知语言不由前端主动跳过", () => {
    expect(has_target_language_character("plain english line", "ALL")).toBe(true);
    expect(should_skip_by_language_filter("plain english line", "ALL")).toBe(false);
    expect(has_target_language_character("plain english line", "XX")).toBe(true);
    expect(should_skip_by_language_filter("plain english line", "XX")).toBe(false);
  });

  it("按目标语言字符判断是否需要语言跳过", () => {
    expect(should_skip_by_language_filter("plain english line", "JA")).toBe(true);
    expect(should_skip_by_language_filter("plain english line", "EN")).toBe(false);
    expect(should_skip_by_language_filter("Привет", "RU")).toBe(false);
    expect(should_skip_by_language_filter("مرحبا", "AR")).toBe(false);
    expect(should_skip_by_language_filter("ภาษาไทย", "TH")).toBe(false);
    expect(should_skip_by_language_filter("français", "FR")).toBe(false);
  });
});
