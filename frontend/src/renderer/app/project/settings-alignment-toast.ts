import type { ProjectPrefilterRunnerSettings } from "@/app/project/derived/project-prefilter-runner";
import type { LocaleKey } from "@/i18n";

type Translate = (key: LocaleKey) => string;

export type ProjectSettingsAlignmentChangedFields = Partial<{
  source_language: boolean;
  target_language: boolean;
  mtool_optimizer_enable: boolean;
}>;

const LANGUAGE_LABEL_KEY_BY_LANGUAGE: Record<string, LocaleKey> = {
  ALL: "app.project_settings_alignment.language.ALL",
  ZH: "app.project_settings_alignment.language.ZH",
  EN: "app.project_settings_alignment.language.EN",
  JA: "app.project_settings_alignment.language.JA",
  KO: "app.project_settings_alignment.language.KO",
  RU: "app.project_settings_alignment.language.RU",
  AR: "app.project_settings_alignment.language.AR",
  DE: "app.project_settings_alignment.language.DE",
  FR: "app.project_settings_alignment.language.FR",
  PL: "app.project_settings_alignment.language.PL",
  ES: "app.project_settings_alignment.language.ES",
  IT: "app.project_settings_alignment.language.IT",
  PT: "app.project_settings_alignment.language.PT",
  HU: "app.project_settings_alignment.language.HU",
  TR: "app.project_settings_alignment.language.TR",
  TH: "app.project_settings_alignment.language.TH",
  ID: "app.project_settings_alignment.language.ID",
  VI: "app.project_settings_alignment.language.VI",
};

function format_language_label(language: string, t: Translate): string {
  const normalized_language = language.trim().toUpperCase();
  const language_key =
    LANGUAGE_LABEL_KEY_BY_LANGUAGE[normalized_language] ??
    (`app.language.${normalized_language}` as LocaleKey);
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

  if (rows.length === 0) {
    return args.t("app.feedback.project_settings_aligned");
  }

  return [args.t("app.feedback.project_settings_aligned"), ...rows].join("\n");
}
