import { zh_cn_post_translation_replacement_page } from '@/i18n/resources/zh-CN/post-translation-replacement-page'
import type { LocaleMessageSchema } from '@/i18n/types'

export const en_us_post_translation_replacement_page = {
  title: 'Post-translation',
  summary: 'After translation, matched parts of the original text will be replaced by specified text, processed in top-down order',
} satisfies LocaleMessageSchema<typeof zh_cn_post_translation_replacement_page>
