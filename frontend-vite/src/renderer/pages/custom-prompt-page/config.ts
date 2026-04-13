import type { LocaleKey } from '@/i18n'

export type CustomPromptVariant = 'translation' | 'analysis'

export type CustomPromptVariantConfig = {
  task_type: 'translation' | 'analysis'
  title_key: LocaleKey
  header_title_key: LocaleKey
  header_description_key: LocaleKey
  default_preset_settings_key:
    | 'translation_custom_prompt_default_preset'
    | 'analysis_custom_prompt_default_preset'
}

export const CUSTOM_PROMPT_VARIANT_CONFIG: Record<
  CustomPromptVariant,
  CustomPromptVariantConfig
> = {
  translation: {
    task_type: 'translation',
    title_key: 'translation_prompt_page.title',
    header_title_key: 'translation_prompt_page.header.title',
    header_description_key: 'translation_prompt_page.header.description_html',
    default_preset_settings_key: 'translation_custom_prompt_default_preset',
  },
  analysis: {
    task_type: 'analysis',
    title_key: 'analysis_prompt_page.title',
    header_title_key: 'analysis_prompt_page.header.title',
    header_description_key: 'analysis_prompt_page.header.description_html',
    default_preset_settings_key: 'analysis_custom_prompt_default_preset',
  },
}
