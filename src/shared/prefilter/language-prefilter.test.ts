import { describe, expect, it } from "vitest";

import { should_skip_by_language_prefilter } from "./language-prefilter";
import { is_app_error } from "../error";

describe("language-prefilter", () => {
  it("ALL 不由预过滤主动跳过", () => {
    expect(should_skip_by_language_prefilter("plain english line", "ALL")).toBe(false);
  });

  it("未知语言会显式报错，避免损坏配置静默漏过滤", () => {
    let code: string | null = null;
    try {
      should_skip_by_language_prefilter("plain english line", "XX");
    } catch (error) {
      code = is_app_error(error) ? error.code : null;
    }
    expect(code).toBe("language.unknown_source_language_code");
  });

  it.each([
    ["ZH", "你好世界", false],
    ["ZH", "Hello World", true],
    ["zh", "你好世界", false],
  ] as const)("语言码 %s 按目标文字决定是否过滤", (source_language, text, expected) => {
    expect(should_skip_by_language_prefilter(text, source_language)).toBe(expected);
  });
});
