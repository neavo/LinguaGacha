import type { ProjectPrefilterRunnerSettings } from "@/project/prefilter/prefilter-runner";
import type { LocaleKey } from "@/app/locale/locale-provider";
import { get_language_label_key, normalize_language_code } from "@base/setting";

type Translate = (key: LocaleKey) => string;

export type ProjectSettingsAlignmentChangedFields = Partial<{
  source_language: boolean;
  target_language: boolean;
  mtool_optimizer_enable: boolean;
  skip_duplicate_source_text_enable: boolean;
}>;

function format_language_label(language: string, t: Translate): string {
  const normalized_language = language.trim().toUpperCase();
  const language_code = normalize_language_code(normalized_language);
  if (language_code === null) {
    return normalized_language;
  }

  const language_key = get_language_label_key(language_code);
  const language_label = t(language_key);
  if (language_label === language_key) {
    return normalized_language;
  }
  return language_label;
}

export function format_project_settings_aligned_toast(args: {
  settings: ProjectPrefilterRunnerSettings;
  changed_fields: ProjectSettingsAlignmentChangedFields;
  t: Translate;
}): string {
  const rows: string[] = [];

  if (args.changed_fields.source_language === true) {
    rows.push(
      `${args.t("app.project_settings_alignment.field.source_language")} - ${format_language_label(args.settings.source_language, args.t)}`,
    );
  }

  if (args.changed_fields.target_language === true) {
    rows.push(
      `${args.t("app.project_settings_alignment.field.target_language")} - ${format_language_label(args.settings.target_language, args.t)}`,
    );
  }

  if (args.changed_fields.mtool_optimizer_enable === true) {
    const mtool_label = args.settings.mtool_optimizer_enable
      ? args.t("app.toggle.enabled")
      : args.t("app.toggle.disabled");
    rows.push(
      `${args.t("app.project_settings_alignment.field.mtool_optimizer_enable")} - ${mtool_label}`,
    );
  }

  if (args.changed_fields.skip_duplicate_source_text_enable === true) {
    const skip_duplicate_source_text_label = args.settings.skip_duplicate_source_text_enable
      ? args.t("app.toggle.enabled")
      : args.t("app.toggle.disabled");
    rows.push(
      `${args.t("app.project_settings_alignment.field.skip_duplicate_source_text_enable")} - ${skip_duplicate_source_text_label}`,
    );
  }

  if (rows.length === 0) {
    return args.t("app.feedback.project_settings_aligned");
  }

  return [args.t("app.feedback.project_settings_aligned"), ...rows].join("\n");
}
