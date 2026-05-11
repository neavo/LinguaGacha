import { describe, expect, it } from "vitest";

import {
  has_prefilter_language_character,
  should_skip_by_language_prefilter,
} from "./language-prefilter";

describe("language-prefilter", () => {
  it("ALL 和未知语言不由预过滤主动跳过", () => {
    expect(has_prefilter_language_character("plain english line", "ALL")).toBe(true);
    expect(should_skip_by_language_prefilter("plain english line", "ALL")).toBe(false);
    expect(has_prefilter_language_character("plain english line", "XX")).toBe(true);
    expect(should_skip_by_language_prefilter("plain english line", "XX")).toBe(false);
  });

  it("按目标语言字符判断是否需要语言跳过", () => {
    expect(should_skip_by_language_prefilter("plain english line", "JA")).toBe(true);
    expect(should_skip_by_language_prefilter("plain english line", "EN")).toBe(false);
    expect(should_skip_by_language_prefilter("Привет", "RU")).toBe(false);
    expect(should_skip_by_language_prefilter("مرحبا", "AR")).toBe(false);
    expect(should_skip_by_language_prefilter("ภาษาไทย", "TH")).toBe(false);
    expect(should_skip_by_language_prefilter("français", "FR")).toBe(false);
  });
});
