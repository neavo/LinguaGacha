import { zh_cn_setting } from '@/i18n/resources/zh-CN/setting'
import type { LocaleMessageSchema } from '@/i18n/types'

export const en_us_setting = {
  page: {
    app: {
      summary: 'App settings will host desktop-level preferences, window behavior, and global experience switches.',
    },
    basic: {
      summary: 'Basic settings will gather the common preferences so everyday configuration stays lightweight.',
    },
    expert: {
      summary: 'Expert settings will host advanced switches and debugging entry points without overloading the main flow.',
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_setting>
