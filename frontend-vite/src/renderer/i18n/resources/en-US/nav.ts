import { zh_cn_nav } from '@/i18n/resources/zh-CN/nav'
import type { LocaleMessageSchema } from '@/i18n/types'

export const en_us_nav = {
  item: {
    model: 'Model Management',
    translation: 'Translation',
    analysis: 'Analysis',
    proofreading: 'Proofreading',
    workbench: 'Workbench',
    basic_settings: 'Basic Settings',
    expert_settings: 'Expert Settings',
    glossary: 'Glossary',
    text_preserve: 'Text Preserve',
    text_replacement: 'Text Replacement',
    pre_translation_replacement: 'Pre-Translation Replacement',
    post_translation_replacement: 'Post-Translation Replacement',
    custom_prompt: 'Custom Prompts',
    translation_prompt: 'Translation Prompt',
    analysis_prompt: 'Analysis Prompt',
    laboratory: 'Laboratory',
    toolbox: 'Toolbox',
  },
  action: {
    theme: 'Theme',
    language: 'Language',
    app_settings: 'App Settings',
  },
} satisfies LocaleMessageSchema<typeof zh_cn_nav>
