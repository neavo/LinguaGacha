import type { Locale } from "../shared/i18n/types";
import type { TranslationPromptLanguage } from "../shared/text/translation-output-format";
import type { LanguageDisplayLocale } from "./language";

export const APP_LANGUAGES = ["ZH", "EN", "DE"] as const; // 顺序同时是设置合法值域和界面循环切换顺序

export type AppLanguage = (typeof APP_LANGUAGES)[number];

type AppLanguageDefinition = Readonly<{
  locale: Locale;
  display_locale: LanguageDisplayLocale;
  prompt_language: TranslationPromptLanguage;
}>;

export const APP_LANGUAGE_DEFINITIONS: Readonly<Record<AppLanguage, AppLanguageDefinition>> =
  Object.freeze({
    ZH: Object.freeze({
      locale: "zh-CN",
      display_locale: "zh",
      prompt_language: "zh",
    }),
    EN: Object.freeze({
      locale: "en-US",
      display_locale: "en",
      prompt_language: "en",
    }),
    DE: Object.freeze({
      locale: "de-DE",
      display_locale: "de",
      prompt_language: "en",
    }),
  });

const APP_LANGUAGE_SET: ReadonlySet<AppLanguage> = new Set(APP_LANGUAGES);

export function is_app_language(value: unknown): value is AppLanguage {
  return APP_LANGUAGE_SET.has(value as AppLanguage);
}

export function normalize_app_language(value: unknown): AppLanguage {
  const normalized_value = String(value ?? "")
    .trim()
    .toUpperCase();
  return is_app_language(normalized_value) ? normalized_value : "ZH";
}

export function resolve_app_locale(app_language: unknown): Locale {
  return APP_LANGUAGE_DEFINITIONS[normalize_app_language(app_language)].locale;
}

export function resolve_language_display_locale(app_language: unknown): LanguageDisplayLocale {
  return APP_LANGUAGE_DEFINITIONS[normalize_app_language(app_language)].display_locale;
}

export function resolve_prompt_template_language(app_language: unknown): TranslationPromptLanguage {
  return APP_LANGUAGE_DEFINITIONS[normalize_app_language(app_language)].prompt_language;
}

export function resolve_app_language_from_locale_tag(locale_tag: unknown): AppLanguage {
  const primary_language =
    String(locale_tag ?? "")
      .trim()
      .split("-")[0] ?? "";
  return normalize_app_language(primary_language);
}

export function resolve_next_app_language(app_language: AppLanguage): AppLanguage {
  const current_index = APP_LANGUAGES.indexOf(app_language);
  return APP_LANGUAGES[(current_index + 1) % APP_LANGUAGES.length]!;
}
