import { normalize_language_code } from "@domain/language";
import {
  PROJECT_PREFILTER_SETTING_KEYS,
  type ProjectLanguageKey,
  type ProjectPrefilterSettings,
} from "@domain/project-settings";
import { get_language_label_key } from "@frontend/app/locale/language-label";
import type { TextResolver } from "@shared/i18n";

type SettingsChanges = Partial<Record<ProjectLanguageKey, string> & ProjectPrefilterSettings>;
const LANGUAGE_FIELDS = ["source_language", "target_language"] as const;

/** 反馈只列出本次保存的变化，语言代码和开关状态沿用界面文案。 */
export function format_project_settings_saved_toast(
  changes: SettingsChanges,
  t: TextResolver,
): string {
  const rows = [t("app.feedback.project_settings_saved")];
  for (const field of LANGUAGE_FIELDS) {
    const value = changes[field];
    if (value === undefined) continue;
    const language = normalize_language_code(value);
    rows.push(
      t("app.tooltip.value", {
        TITLE: t(
          field === "source_language" ? "app.language_role.source" : "app.language_role.target",
        ),
        VALUE: language === null ? value : t(get_language_label_key(language)),
      }),
    );
  }
  for (const field of PROJECT_PREFILTER_SETTING_KEYS) {
    const enabled = changes[field];
    if (enabled === undefined) continue;
    rows.push(
      t("app.tooltip.value", {
        TITLE: t(`app.project_prefilter.${field}.title`),
        VALUE: t(enabled ? "app.state.enabled" : "app.state.disabled"),
      }),
    );
  }
  return rows.join("\n");
}
