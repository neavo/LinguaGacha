import { zh_cn_text_replacement_page } from '@/i18n/resources/zh-CN/text-replacement-page'
import type { LocaleMessageSchema } from '@/i18n/types'

export const en_us_text_replacement_page = {
  title: 'Text Replacement',
  summary: 'The text replacement page will unify pre- and post-translation rules to reduce repetitive cleanup.',
} satisfies LocaleMessageSchema<typeof zh_cn_text_replacement_page>
