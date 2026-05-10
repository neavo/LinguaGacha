import type { SettingsSnapshot } from "@/app/desktop/desktop-runtime-context";
import type { LocaleKey } from "@/i18n";
import {
  ALL_LANGUAGE_CODE,
  SOURCE_TARGET_LANGUAGE_CODES,
  type SourceTargetLanguageCode,
} from "@shared/rules/languages";

export const ALL_LANGUAGE_VALUE = ALL_LANGUAGE_CODE;

export const PROJECT_SAVE_MODE = {
  MANUAL: "MANUAL",
  FIXED: "FIXED",
  SOURCE: "SOURCE",
} as const;

export const LANGUAGE_CODES = SOURCE_TARGET_LANGUAGE_CODES;

export const REQUEST_TIMEOUT_MIN = 0;
export const REQUEST_TIMEOUT_MAX = 9_999_999;

export type ProjectSaveMode = (typeof PROJECT_SAVE_MODE)[keyof typeof PROJECT_SAVE_MODE];

type LanguageCode = SourceTargetLanguageCode;

export type BasicSettingsPendingField =
  | "source_language"
  | "target_language"
  | "project_save_mode"
  | "output_folder_open_on_finish"
  | "request_timeout";

export type SettingPendingState = Record<BasicSettingsPendingField, boolean>;

export type BasicSettingsSnapshot = Pick<
  SettingsSnapshot,
  | "source_language"
  | "target_language"
  | "project_save_mode"
  | "project_fixed_path"
  | "output_folder_open_on_finish"
  | "request_timeout"
>;

export const LANGUAGE_LABEL_KEYS: Readonly<
  Record<LanguageCode | typeof ALL_LANGUAGE_VALUE, LocaleKey>
> = {
  ALL: "app.language.ALL",
  ZH: "app.language.ZH",
  EN: "app.language.EN",
  JA: "app.language.JA",
  KO: "app.language.KO",
  RU: "app.language.RU",
  AR: "app.language.AR",
  DE: "app.language.DE",
  FR: "app.language.FR",
  PL: "app.language.PL",
  ES: "app.language.ES",
  IT: "app.language.IT",
  PT: "app.language.PT",
  HU: "app.language.HU",
  TR: "app.language.TR",
  TH: "app.language.TH",
  ID: "app.language.ID",
  VI: "app.language.VI",
};

export const PROJECT_SAVE_MODE_LABEL_KEYS: Readonly<Record<ProjectSaveMode, LocaleKey>> = {
  MANUAL: "basic_settings_page.fields.project_save_mode.options.manual",
  FIXED: "basic_settings_page.fields.project_save_mode.options.fixed",
  SOURCE: "basic_settings_page.fields.project_save_mode.options.source",
};

export function build_basic_settings_snapshot(
  settings_snapshot: SettingsSnapshot,
): BasicSettingsSnapshot {
  return {
    source_language: settings_snapshot.source_language,
    target_language: settings_snapshot.target_language,
    project_save_mode: settings_snapshot.project_save_mode,
    project_fixed_path: settings_snapshot.project_fixed_path,
    output_folder_open_on_finish: settings_snapshot.output_folder_open_on_finish,
    request_timeout: settings_snapshot.request_timeout,
  };
}

export function is_project_save_mode(candidate: string): candidate is ProjectSaveMode {
  return Object.values(PROJECT_SAVE_MODE).includes(candidate as ProjectSaveMode);
}
