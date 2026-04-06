import { zh_cn_app_settings_page } from '@/i18n/resources/zh-CN/app-settings-page'
import type { LocaleMessageSchema } from '@/i18n/types'

export const en_us_app_settings_page = {
  title: 'App Settings',
  summary: 'App settings will host desktop-level preferences, window behavior, and global experience switches.',
  fields: {
    expert_mode: {
      title: 'Expert Mode',
      description: 'When enabled, more log and advanced settings will be shown, restart to apply',
    },
  },
  restart_confirm: {
    title: 'App Restart Required',
    description: 'This setting takes effect after the app restarts. Confirming will close the current app immediately, so please make sure your current work is safe first.',
    actions: {
      cancel: 'Later',
      confirm: 'Quit Now',
    },
  },
  feedback: {
    retry: 'Retry',
    refresh_failed: 'Unable to refresh app settings right now. Please try again later.',
    refresh_failed_title: 'Failed to Load App Settings',
    update_failed: 'Failed to save the setting. Please try again later.',
    quit_failed: 'Unable to close the app right now. Please restart it manually later.',
  },
} satisfies LocaleMessageSchema<typeof zh_cn_app_settings_page>
