import type { SettingsSnapshot } from "@/app/desktop/desktop-runtime-context";
import type { LocaleKey } from "@/app/locale/locale-provider";
import {
  ALL_LANGUAGE_CODE,
  PROJECT_SAVE_MODES,
  SOURCE_LANGUAGE_CODES,
  TARGET_LANGUAGE_CODES,
  type ProjectSaveMode,
} from "@base/setting";

export type { ProjectSaveMode };

export const ALL_LANGUAGE_VALUE = ALL_LANGUAGE_CODE;

export { SOURCE_LANGUAGE_CODES, TARGET_LANGUAGE_CODES };

export const REQUEST_TIMEOUT_MIN = 0;
export const REQUEST_TIMEOUT_MAX = 9_999_999;

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

export const PROJECT_SAVE_MODE_LABEL_KEYS: Readonly<Record<ProjectSaveMode, LocaleKey>> = {
  MANUAL: "basic_settings_page.fields.project_save_mode.options.manual",
  FIXED: "basic_settings_page.fields.project_save_mode.options.fixed",
  SOURCE: "basic_settings_page.fields.project_save_mode.options.source",
};

export const PROJECT_SAVE_MODE_OPTIONS = PROJECT_SAVE_MODES;

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
  return PROJECT_SAVE_MODES.includes(candidate as ProjectSaveMode);
}
