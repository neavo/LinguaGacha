import { is_json_record } from "@domain/json";
import { normalize_source_language_code, normalize_target_language_code } from "@domain/language";
import {
  DEFAULT_PROJECT_LANGUAGE_SETTINGS,
  type ProjectLanguageKey,
  type ProjectLanguageSettings,
} from "@domain/project-settings";

export const PROJECT_LANGUAGE_PREFERENCE_STORAGE_KEY = "lg-project-create-languages"; // 新建偏好独立于 `.lg` 项目语言。

/** 按字段恢复上次确认值，读取时保留存储原文。 */
export function read_project_language_preference(): ProjectLanguageSettings {
  try {
    const raw = window.localStorage.getItem(PROJECT_LANGUAGE_PREFERENCE_STORAGE_KEY);
    if (raw === null) return DEFAULT_PROJECT_LANGUAGE_SETTINGS;
    const value: unknown = JSON.parse(raw);
    if (!is_json_record(value)) return DEFAULT_PROJECT_LANGUAGE_SETTINGS;

    return {
      source_language:
        (typeof value.source_language === "string"
          ? normalize_source_language_code(value.source_language)
          : null) ?? DEFAULT_PROJECT_LANGUAGE_SETTINGS.source_language,
      target_language:
        (typeof value.target_language === "string"
          ? normalize_target_language_code(value.target_language)
          : null) ?? DEFAULT_PROJECT_LANGUAGE_SETTINGS.target_language,
    };
  } catch {
    // 辅助偏好丢失可接受，存储或解析失败时使用默认语言。
    return DEFAULT_PROJECT_LANGUAGE_SETTINGS;
  }
}

/** 保存用户确认值，后续取消路径或创建失败也保留这次选择。 */
export function save_project_language_preference(
  languages: Readonly<Record<ProjectLanguageKey, string>>,
): void {
  try {
    window.localStorage.setItem(
      PROJECT_LANGUAGE_PREFERENCE_STORAGE_KEY,
      JSON.stringify({
        source_language: languages.source_language,
        target_language: languages.target_language,
      }),
    );
  } catch {
    // 辅助偏好丢失可接受，写入失败不能中断内存草稿的创建流程。
  }
}
