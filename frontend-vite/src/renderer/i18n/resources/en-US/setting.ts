import { zh_cn_setting } from '@/i18n/resources/zh-CN/setting'
import type { LocaleMessageSchema } from '@/i18n/types'

export const en_us_setting = {
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
  page: {
    app: {
      summary: 'App settings will host desktop-level preferences, window behavior, and global experience switches.',
    },
    basic: {
      eyebrow: 'BASIC SETTINGS',
      title: 'Basic Settings',
      summary: 'Keep source language, target language, project save location, output-folder behavior, and request timeout in one place with instant persistence.',
      busy: {
        title: 'Task Running',
        description: 'Language settings are temporarily locked while a task is running. Update them after the current flow finishes.',
      },
      fields: {
        source_language: {
          title: 'Source Language',
          description: 'Controls source detection and language filtering. "All" means the source language stays unrestricted.',
        },
        target_language: {
          title: 'Target Language',
          description: 'Constrains the model output language so the translation pipeline keeps a single language target.',
        },
        project_save_mode: {
          title: 'Project Save Location',
          description: 'Decides where new .lg project files are saved by default.',
          description_fixed: 'Fixed directory: {PATH}',
          options: {
            manual: 'Choose every time',
            fixed: 'Fixed directory',
            source: 'Next to source files',
          },
        },
        output_folder_open_on_finish: {
          title: 'Open Output Folder When Finished',
          description: 'Open the output directory automatically after translation or export so the result is ready for review.',
        },
        request_timeout: {
          title: 'Request Timeout',
          description: 'Treat the request as timed out once the configured seconds elapse without a response, and save each change immediately.',
        },
      },
      feedback: {
        saving: 'Saving',
        retry: 'Retry',
        refresh_failed: 'Unable to refresh basic settings right now. Please try again later.',
        refresh_failed_title: 'Failed to Load Basic Settings',
        update_failed: 'Failed to save the setting. Please try again later.',
        pick_directory_failed: 'Directory selection failed. Please choose the fixed save directory again.',
      },
      footnote: {
        title: 'Instant Save',
        description: 'Each setting is written back to the desktop config immediately. Canceling the fixed-directory picker keeps the previous value.',
      },
    },
    expert: {
      summary: 'Expert settings will host advanced switches and debugging entry points without overloading the main flow.',
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_setting>
