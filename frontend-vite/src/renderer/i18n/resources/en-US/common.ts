import { zh_cn_common } from '@/i18n/resources/zh-CN/common'
import type { LocaleMessageSchema } from '@/i18n/types'

export const en_us_common = {
  aria: {
    toggle_navigation: 'Toggle navigation',
  },
  metadata: {
    app_name: 'LinguaGacha',
  },
  action: {
    start: 'Start',
    stop: 'Stop',
    reset: 'Reset',
    timer: 'Timer',
  },
  workspace: {
    default_title: 'Workspace',
    preview_eyebrow: 'Desktop Shell Preview',
    sidebar_width_expanded: 'Sidebar width 256px',
    sidebar_width_collapsed: 'Sidebar width 72px',
    placeholder_chip: 'The right pane is still a placeholder',
    content_title: 'Content Workspace',
    commandbar_hint: 'Real commands and status feedback will be mounted here later',
  },
  project: {
    model: {
      summary: 'Model management will host provider setup, switching policy, and runtime readiness as the entry point of the desktop workflow.',
    },
  },
  profile: {
    status: 'Ciallo～(∠・ω< )⌒✮',
  },
} satisfies LocaleMessageSchema<typeof zh_cn_common>
