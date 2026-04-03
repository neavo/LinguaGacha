import { en_us_common } from '@/i18n/resources/en-US/common'
import { en_us_extra } from '@/i18n/resources/en-US/extra'
import { en_us_nav } from '@/i18n/resources/en-US/nav'
import { en_us_quality } from '@/i18n/resources/en-US/quality'
import { en_us_setting } from '@/i18n/resources/en-US/setting'
import { en_us_task } from '@/i18n/resources/en-US/task'
import { zh_cn_messages } from '@/i18n/resources/zh-CN'
import type { LocaleMessageSchema } from '@/i18n/types'

export const en_us_messages = {
  common: en_us_common,
  nav: en_us_nav,
  task: en_us_task,
  setting: en_us_setting,
  quality: en_us_quality,
  extra: en_us_extra,
} satisfies LocaleMessageSchema<typeof zh_cn_messages>
