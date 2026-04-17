import type { LocaleKey } from '@/i18n'

export type TextReplacementVariant = 'pre' | 'post'

export type TextReplacementVariantConfig = {
  rule_type: 'pre_replacement' | 'post_replacement'
  statistics_mode: 'pre_replacement' | 'post_replacement'
  preset_dir_name: 'pre_translation_replacement' | 'post_translation_replacement'
  default_preset_settings_key:
    | 'pre_translation_replacement_default_preset'
    | 'post_translation_replacement_default_preset'
  title_key: LocaleKey
  export_file_name: string
}

export const TEXT_REPLACEMENT_VARIANT_CONFIG: Record<
  TextReplacementVariant,
  TextReplacementVariantConfig
> = {
  pre: {
    rule_type: 'pre_replacement',
    statistics_mode: 'pre_replacement',
    preset_dir_name: 'pre_translation_replacement',
    default_preset_settings_key: 'pre_translation_replacement_default_preset',
    title_key: 'pre_translation_replacement_page.title',
    export_file_name: 'pre_translation_replacement.json',
  },
  post: {
    rule_type: 'post_replacement',
    statistics_mode: 'post_replacement',
    preset_dir_name: 'post_translation_replacement',
    default_preset_settings_key: 'post_translation_replacement_default_preset',
    title_key: 'post_translation_replacement_page.title',
    export_file_name: 'post_translation_replacement.json',
  },
}
