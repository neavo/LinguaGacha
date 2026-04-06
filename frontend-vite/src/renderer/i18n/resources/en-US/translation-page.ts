import { zh_cn_translation_page } from '@/i18n/resources/zh-CN/translation-page'
import type { LocaleMessageSchema } from '@/i18n/types'

export const en_us_translation_page = {
  title: 'Translation',
  summary: 'The translation page will plug in batch execution, status tracking, and result write-back here.',
} satisfies LocaleMessageSchema<typeof zh_cn_translation_page>
