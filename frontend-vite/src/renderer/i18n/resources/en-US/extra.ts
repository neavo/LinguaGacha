import { zh_cn_extra } from '@/i18n/resources/zh-CN/extra'
import type { LocaleMessageSchema } from '@/i18n/types'

export const en_us_extra = {
  page: {
    laboratory: {
      summary: 'The laboratory will collect experimental features that are still being shaped and validated.',
    },
    toolbox: {
      summary: 'The toolbox will gather standalone helpers so scattered needs have a stable home.',
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_extra>
