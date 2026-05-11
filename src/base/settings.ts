export {
  ALL_LANGUAGE_CODE,
  CJK_LANGUAGE_CODES,
  LANGUAGE_DEFINITIONS,
  SOURCE_TARGET_LANGUAGE_CODES,
  all_language_characters,
  has_language_character,
  is_language_character,
  normalize_language_code,
  strip_non_language_characters,
  type LanguageCode,
  type SourceTargetLanguageCode,
} from "../shared/rules/languages";

// AppLanguage 是配置文件、运行态 settings 和 i18n locale 派生的唯一语言值域。
export const APP_LANGUAGES = ["ZH", "EN"] as const;

// AppLocale 只服务 renderer i18n，不替代设置快照中的 app_language。
export const APP_LOCALES = ["zh-CN", "en-US"] as const;

// ProjectSaveMode 是项目保存位置策略，页面和配置服务都从这里取合法值。
export const PROJECT_SAVE_MODES = ["MANUAL", "FIXED", "SOURCE"] as const;

export type AppLanguage = (typeof APP_LANGUAGES)[number];
export type AppLocale = (typeof APP_LOCALES)[number];
export type ProjectSaveMode = (typeof PROJECT_SAVE_MODES)[number];

const APP_LANGUAGE_SET = new Set<AppLanguage>(APP_LANGUAGES);
const PROJECT_SAVE_MODE_SET = new Set<ProjectSaveMode>(PROJECT_SAVE_MODES);

// 配置文件和设置页 payload 统一通过这里确认语言值域。
export function is_app_language(value: unknown): value is AppLanguage {
  return APP_LANGUAGE_SET.has(value as AppLanguage);
}

// app_language 兼容大小写输入，未知值回退中文界面。
export function normalize_app_language(value: unknown): AppLanguage {
  const language = String(value ?? "")
    .trim()
    .toUpperCase();
  return is_app_language(language) ? language : "ZH";
}

// i18n locale 是 app_language 的派生结果，不单独持久化为第二状态源。
export function resolve_app_locale(app_language: AppLanguage): AppLocale {
  return app_language === "EN" ? "en-US" : "zh-CN";
}

// 项目保存模式写入配置前先确认合法值，避免页面草稿值落盘。
export function is_project_save_mode(value: unknown): value is ProjectSaveMode {
  return PROJECT_SAVE_MODE_SET.has(value as ProjectSaveMode);
}

// 缺失或未知保存模式按历史手动保存策略处理。
export function normalize_project_save_mode(value: unknown): ProjectSaveMode {
  return is_project_save_mode(value) ? value : "MANUAL";
}
