import { zh_cn_laboratory_page } from '@/i18n/resources/zh-CN/laboratory-page'
import type { LocaleMessageSchema } from '@/i18n/types'

export const en_us_laboratory_page = {
  title: 'Laboratory',
  fields: {
    mtool_optimizer_enable: {
      title: 'MTool Optimizer',
      description: (
        'Can reduce translation time and Token usage by up to 40% when translating MTool text'
        + '\n'
        + 'May lead to issues like <emphasis>residual original text</emphasis> or <emphasis>incoherent sentences</emphasis>. Please <emphasis>decide for yourself</emphasis> whether to enable this feature, and it should <emphasis>only be enabled when translating MTool text</emphasis>'
      ),
      help_label: 'Open MTool Optimizer documentation',
    },
    force_thinking_enable: {
      title: 'Force Thinking',
      description: (
        'When enabled, non-thinking models will also perform thinking before translation, enabled by default, and does not support SakuraLLM'
        + '\n'
        + '◈ Trade a slight increase in Token consumption for improved translation quality'
        + '\n'
        + '◈ Not recommended for reasoning models, as redundant reasoning provides little benefit'
        + '\n'
        + '◈ When functioning normally, model reasoning output will be visible in the translation logs'
      ),
      help_label: 'Open Force Thinking documentation',
    },
  },
  feedback: {
    retry: 'Retry',
    refresh_failed: 'Unable to refresh laboratory settings right now. Please try again later.',
    refresh_failed_title: 'Failed to load laboratory settings',
    update_failed: 'Failed to save laboratory settings. Please try again later.',
  },
} satisfies LocaleMessageSchema<typeof zh_cn_laboratory_page>
