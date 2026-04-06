import { zh_cn_translation_prompt_page } from '@/i18n/resources/zh-CN/translation-prompt-page'
import type { LocaleMessageSchema } from '@/i18n/types'

export const en_us_translation_prompt_page = {
  title: 'Translation Prompts',
  summary: 'Translation prompts will shape how the model interprets tone, characters, and output requirements.',
} satisfies LocaleMessageSchema<typeof zh_cn_translation_prompt_page>
