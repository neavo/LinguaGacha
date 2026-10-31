// 设置编码沿用持久化值。菜单、语言资源裁剪和启动语言选择共用这份声明。
export const APP_LANGUAGE_DEFINITIONS = [
  { code: "ZH", locale: "zh-CN", name: "中文" },
  { code: "JA", locale: "ja-JP", name: "日本語" },
  { code: "KO", locale: "ko-KR", name: "한국어" },
  { code: "EN", locale: "en-US", name: "English" },
  { code: "DE", locale: "de-DE", name: "Deutsch" },
] as const;

export type AppLanguage = (typeof APP_LANGUAGE_DEFINITIONS)[number]["code"];
export type Locale = (typeof APP_LANGUAGE_DEFINITIONS)[number]["locale"];
export const LOCALES: readonly Locale[] = APP_LANGUAGE_DEFINITIONS.map(({ locale }) => locale);

/** 内置提示词模板使用的语言值域。 */
export type TranslationPromptLanguage = "zh" | "en";

/** 菜单值使用严格校验，持久化设置由归一化入口处理。 */
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

/** 中英文以外的界面语言共用英文提示词模板。 */
export function resolve_prompt_template_language(app_language: unknown): TranslationPromptLanguage {
  return normalize_app_language(app_language) === "ZH" ? "zh" : "en";
}

/** 界面设置尚不可用时按宿主语言选择文案，未知值使用中文。 */
export function resolve_app_language_from_locale_tag(locale_tag: unknown): AppLanguage {
  const primary_language =
    String(locale_tag ?? "")
      .trim()
      .split("-")[0] ?? "";
  return normalize_app_language(primary_language);
}

/** 每种主语言只有一个发行变体，按系统偏好顺序匹配，全部不支持时使用英文。 */
export function resolve_system_locale(preferred_languages: readonly string[]): Locale {
  for (const preferred_language of preferred_languages) {
    const primary_language = preferred_language.trim().toLowerCase().split("-")[0];
    const definition = APP_LANGUAGE_DEFINITIONS.find(
      ({ locale }) => locale.split("-")[0] === primary_language,
    );
    if (definition !== undefined) return definition.locale;
  }
  return "en-US";
}
