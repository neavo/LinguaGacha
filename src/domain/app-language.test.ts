import { describe, expect, it } from "vitest";

import {
  APP_LANGUAGES,
  normalize_app_language,
  resolve_app_language_from_locale_tag,
  resolve_app_locale,
  resolve_language_display_locale,
  resolve_next_app_language,
  resolve_prompt_template_language,
} from "./app-language";

describe("应用语言", () => {
  it.each([
    ["ZH", "zh-CN", "zh", "zh"],
    ["EN", "en-US", "en", "en"],
    ["DE", "de-DE", "de", "en"],
  ] as const)(
    "%s 统一投影到界面、语言显示和提示词资源语言",
    (app_language, locale, display_locale, prompt_language) => {
      expect(resolve_app_locale(app_language)).toBe(locale);
      expect(resolve_language_display_locale(app_language)).toBe(display_locale);
      expect(resolve_prompt_template_language(app_language)).toBe(prompt_language);
    },
  );

  it("未知设置语言回退中文并兼容合法值大小写", () => {
    expect(normalize_app_language(" en ")).toBe("EN");
    expect(normalize_app_language("de")).toBe("DE");
    expect(normalize_app_language("unknown")).toBe("ZH");
  });

  it("从系统 locale tag 解析应用语言", () => {
    expect(resolve_app_language_from_locale_tag("de-DE")).toBe("DE");
    expect(resolve_app_language_from_locale_tag("en-US")).toBe("EN");
    expect(resolve_app_language_from_locale_tag("fr-FR")).toBe("ZH");
  });

  it("按公开语言顺序循环切换", () => {
    expect(APP_LANGUAGES).toEqual(["ZH", "EN", "DE"]);
    expect(resolve_next_app_language("ZH")).toBe("EN");
    expect(resolve_next_app_language("EN")).toBe("DE");
    expect(resolve_next_app_language("DE")).toBe("ZH");
  });
});
