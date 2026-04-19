import { zh_cn_basic_settings_page } from '@/i18n/resources/zh-CN/basic-settings-page'
import type { LocaleMessageSchema } from '@/i18n/types'

export const en_us_basic_settings_page = {
  title: 'Basic Settings',
  fields: {
    source_language: {
      title: 'Source Language',
      description: 'Set the language of the input text in the current project',
    },
    target_language: {
      title: 'Target Language',
      description: 'Set the language of the output text in the current project',
    },
    project_save_mode: {
      title: 'Project Save Location',
      description: 'Set the save location for project files when creating a new project',
      description_fixed: (
        'Set the save location for project files when creating a new project'
        + '\n' + 'currently {PATH}'
      ),
      options: {
        manual: 'Choose every time',
        fixed: 'Fixed directory',
        source: 'Next to source files',
      },
    },
    output_folder_open_on_finish: {
      title: 'Open Output Folder When Finished',
      description: 'When enabled, the output folder will be automatically opened upon task completion',
    },
    request_timeout: {
      title: 'Request Timeout',
      description: (
        'The maximum time (seconds) to wait for response when making a request'
        + '\n' + 'If no reply is received after the timeout, the task will be considered failed'
      ),
    },
  },
  feedback: {
    retry: 'Retry',
    refresh_failed: 'Unable to refresh basic settings right now. Please try again later.',
    refresh_failed_title: 'Failed to Load Basic Settings',
    update_failed: 'Failed to save the setting. Please try again later.',
    pick_directory_failed: 'Directory selection failed. Please choose the fixed save directory again.',
    source_language_loading_toast: 'Refreshing project cache …',
  },
} satisfies LocaleMessageSchema<typeof zh_cn_basic_settings_page>
