import { zh_cn_app } from '@/i18n/resources/zh-CN/app'
import type { LocaleMessageSchema } from '@/i18n/types'

export const en_us_app = {
  aria: {
    toggle_navigation: 'Toggle navigation',
  },
  metadata: {
    app_name: 'LinguaGacha',
  },
  action: {
    cancel: 'Cancel',
    close: 'Close',
    reset: 'Reset',
    retry: 'Retry',
    loading: 'Loading',
    select_file: 'Select File',
    select_folder: 'Select Folder',
  },
  toggle: {
    disabled: 'Disabled',
    enabled: 'Enabled',
  },
  drag: {
    enabled: 'Drag to reorder',
    disabled: 'Drag disabled',
  },
  language: {
    ALL: 'All',
    ZH: 'Chinese',
    EN: 'English',
    JA: 'Japanese',
    KO: 'Korean',
    RU: 'Russian',
    AR: 'Arabic',
    DE: 'German',
    FR: 'French',
    PL: 'Polish',
    ES: 'Spanish',
    IT: 'Italian',
    PT: 'Portuguese',
    HU: 'Hungarian',
    TR: 'Turkish',
    TH: 'Thai',
    ID: 'Indonesian',
    VI: 'Vietnamese',
  },
  navigation_action: {
    theme: 'Theme',
    language: 'Language',
  },
  profile: {
    status: 'Ciallo～(∠・ω< )⌒✮',
  },
} satisfies LocaleMessageSchema<typeof zh_cn_app>
