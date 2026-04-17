import { zh_cn_translation_prompt_page } from '@/i18n/resources/zh-CN/translation-prompt-page'
import type { LocaleMessageSchema } from '@/i18n/types'

export const en_us_translation_prompt_page = {
  title: 'Translation Prompts',
  header: {
    title: 'Custom Translation Prompts (SakuraLLM model not supported)',
    description_html:
      'Add extra translation requirements such as story settings and writing styles via custom prompts'
      + '<br>'
      + 'Note: The prefix and suffix are fixed and cannot be modified'
      + '<br>'
      + 'The content on this page is only used in translation tasks after this page is enabled',
  },
} satisfies LocaleMessageSchema<typeof zh_cn_translation_prompt_page>
