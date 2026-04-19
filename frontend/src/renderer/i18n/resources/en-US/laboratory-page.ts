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
  },
  feedback: {
    retry: 'Retry',
    refresh_failed: 'Unable to refresh laboratory settings right now. Please try again later.',
    refresh_failed_title: 'Failed to load laboratory settings',
    update_failed: 'Failed to save laboratory settings. Please try again later.',
    mtool_optimizer_loading_toast: 'Refreshing project cache …',
  },
} satisfies LocaleMessageSchema<typeof zh_cn_laboratory_page>
