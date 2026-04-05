import type { SettingsSnapshot } from '@/app/state/desktop-runtime-context'
import type { LocaleKey } from '@/i18n'

export const ALL_LANGUAGE_VALUE = 'ALL'

export const PROJECT_SAVE_MODE = {
  MANUAL: 'MANUAL',
  FIXED: 'FIXED',
  SOURCE: 'SOURCE',
} as const

export const LANGUAGE_CODES = [
  'ZH',
  'EN',
  'JA',
  'KO',
  'RU',
  'AR',
  'DE',
  'FR',
  'PL',
  'ES',
  'IT',
  'PT',
  'HU',
  'TR',
  'TH',
  'ID',
  'VI',
] as const

export const REQUEST_TIMEOUT_MIN = 0
export const REQUEST_TIMEOUT_MAX = 9_999_999

export type ProjectSaveMode = (typeof PROJECT_SAVE_MODE)[keyof typeof PROJECT_SAVE_MODE]

type LanguageCode = (typeof LANGUAGE_CODES)[number]

export type BasicSettingsPendingField =
  | 'source_language'
  | 'target_language'
  | 'project_save_mode'
  | 'output_folder_open_on_finish'
  | 'request_timeout'

export type SettingPendingState = Record<BasicSettingsPendingField, boolean>

export type BasicSettingsSnapshot = Pick<
  SettingsSnapshot,
  | 'source_language'
  | 'target_language'
  | 'project_save_mode'
  | 'project_fixed_path'
  | 'output_folder_open_on_finish'
  | 'request_timeout'
>

export const LANGUAGE_LABEL_KEYS: Readonly<Record<LanguageCode | typeof ALL_LANGUAGE_VALUE, LocaleKey>> = {
  ALL: 'setting.language.ALL',
  ZH: 'setting.language.ZH',
  EN: 'setting.language.EN',
  JA: 'setting.language.JA',
  KO: 'setting.language.KO',
  RU: 'setting.language.RU',
  AR: 'setting.language.AR',
  DE: 'setting.language.DE',
  FR: 'setting.language.FR',
  PL: 'setting.language.PL',
  ES: 'setting.language.ES',
  IT: 'setting.language.IT',
  PT: 'setting.language.PT',
  HU: 'setting.language.HU',
  TR: 'setting.language.TR',
  TH: 'setting.language.TH',
  ID: 'setting.language.ID',
  VI: 'setting.language.VI',
}

export const PROJECT_SAVE_MODE_LABEL_KEYS: Readonly<Record<ProjectSaveMode, LocaleKey>> = {
  MANUAL: 'setting.page.basic.fields.project_save_mode.options.manual',
  FIXED: 'setting.page.basic.fields.project_save_mode.options.fixed',
  SOURCE: 'setting.page.basic.fields.project_save_mode.options.source',
}

export function build_basic_settings_snapshot(settings_snapshot: SettingsSnapshot): BasicSettingsSnapshot {
  return {
    source_language: settings_snapshot.source_language,
    target_language: settings_snapshot.target_language,
    project_save_mode: settings_snapshot.project_save_mode,
    project_fixed_path: settings_snapshot.project_fixed_path,
    output_folder_open_on_finish: settings_snapshot.output_folder_open_on_finish,
    request_timeout: settings_snapshot.request_timeout,
  }
}

export function is_project_save_mode(candidate: string): candidate is ProjectSaveMode {
  return Object.values(PROJECT_SAVE_MODE).includes(candidate as ProjectSaveMode)
}
