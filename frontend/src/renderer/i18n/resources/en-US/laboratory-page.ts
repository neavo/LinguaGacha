import { zh_cn_laboratory_page } from '@/i18n/resources/zh-CN/laboratory-page'
import type { LocaleMessageSchema } from '@/i18n/types'

export const en_us_laboratory_page = {
  title: 'Laboratory',
  fields: {
    mtool_optimizer_enable: {
      title: 'MTool Optimizer',
      description: (
        'When translating <emphasis>MTool</emphasis> text, reduce translation time and token usage by up to 40%, enabled by default'
        + '\n'
        + '◈ It may cause issues such as <emphasis>leftover source text</emphasis> or <emphasis>awkward sentence flow</emphasis>'
      ),
      help_label: 'View the MTool Optimizer guide',
    },
    force_thinking_enable: {
      title: 'Force Thinking',
      description: (
        'When enabled, non-reasoning models will also think before translating, enabled by default'
        + '\n'
        + '◈ Trades a slight increase in token usage for better translation quality'
        + '\n'
        + '◈ When it works, you can see the model reasoning output in the translation logs'
        + '\n'
        + '◈ <emphasis>This feature does not support SakuraLLM models</emphasis>'
      ),
      help_label: 'View the Force Thinking guide',
    },
  },
  feedback: {
    retry: 'Retry',
    refresh_failed: 'Unable to refresh laboratory settings right now. Please try again later.',
    refresh_failed_title: 'Failed to load laboratory settings',
    update_failed: 'Failed to save laboratory settings. Please try again later.',
  },
} satisfies LocaleMessageSchema<typeof zh_cn_laboratory_page>
