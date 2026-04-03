import { zh_cn_quality } from '@/i18n/resources/zh-CN/quality'
import type { LocaleMessageSchema } from '@/i18n/types'

export const en_us_quality = {
  page: {
    glossary: {
      summary: 'The glossary page will manage terminology entries, enablement, and bulk import outcomes.',
    },
    text_preserve: {
      summary: 'The text preserve page will protect non-translatable segments so formatting and named content stay intact.',
    },
    text_replacement: {
      summary: 'The text replacement page will unify pre- and post-translation rules to reduce repetitive cleanup.',
    },
    pre_translation_replacement: {
      summary: 'Pre-translation replacement will clean the source before tasks start, so the messy work is handled early.',
    },
    post_translation_replacement: {
      summary: 'Post-translation replacement will polish the output before write-back so the final result stays stable.',
    },
    custom_prompt: {
      summary: 'The custom prompts page will collect task-specific constraints and style preferences in one place.',
    },
    translation_prompt: {
      summary: 'Translation prompts will shape how the model interprets tone, characters, and output requirements.',
    },
    analysis_prompt: {
      summary: 'Analysis prompts will define candidate extraction, classification, and diagnostic criteria.',
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_quality>
