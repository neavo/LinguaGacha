import { APP_LANGUAGE_DEFINITIONS, type AppLanguage, type Locale } from "../shared/i18n/types";
import type { TranslationPromptLanguage } from "../shared/text/translation-output-format";

export type { AppLanguage } from "../shared/i18n/types";

/** 菜单值使用严格校验；设置及系统输入由归一化入口处理。 */
export function is_app_language(value: unknown): value is AppLanguage {
  return APP_LANGUAGE_DEFINITIONS.some(({ code }) => code === value);
}

/** 保留合法的持久化编码，缺失或未知值使用中文默认设置。 */
export function normalize_app_language(value: unknown): AppLanguage {
  const normalized_value = String(value ?? "")
    .trim()
    .toUpperCase();
  return is_app_language(normalized_value) ? normalized_value : "ZH";
}

/** 归一化结果必在同一声明中，renderer 无需再次处理回退。 */
export function resolve_app_locale(app_language: unknown): Locale {
  const language = normalize_app_language(app_language);
  return APP_LANGUAGE_DEFINITIONS.find(({ code }) => code === language)!.locale;
}

/** 内置模板维护中英文；其它 UI 语言统一消费英文模板及其说明。 */
export function resolve_prompt_template_language(app_language: unknown): TranslationPromptLanguage {
  return normalize_app_language(app_language) === "ZH" ? "zh" : "en";
}

/** 系统缺省场景只取主语言，不将系统设置覆盖到已保存的选择。 */
export function resolve_app_language_from_locale_tag(locale_tag: unknown): AppLanguage {
  const primary_language =
    String(locale_tag ?? "")
      .trim()
      .split("-")[0] ?? "";
  return normalize_app_language(primary_language);
}
