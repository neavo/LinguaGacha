import { zh_cn_task } from '@/i18n/resources/zh-CN/task'
import type { LocaleMessageSchema } from '@/i18n/types'

export const en_us_task = {
  page: {
    translation: {
      summary: 'The translation page will plug in batch execution, status tracking, and result write-back here.',
    },
    analysis: {
      summary: 'The analysis page will surface candidate pools, coverage, and diagnostic aggregates here.',
    },
    proofreading: {
      summary: 'The proofreading page will carry post-translation checks, diffs, and review pacing.',
    },
    workbench: {
      summary: 'The workbench will gather file lists, progress, and project-level quick actions.',
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_task>
