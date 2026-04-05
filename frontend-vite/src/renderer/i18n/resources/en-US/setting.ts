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
          description: 'Set the language of the input text in the current project',
        },
        target_language: {
          title: 'Target Language',
          description: 'Set the language of the output text in the current project',
        },
        project_save_mode: {
          title: 'Project Save Location',
          description: 'Set the save location for project files when creating a new project',
          description_fixed: 'Set the save location for project files when creating a new project<br>currently {PATH}',
          options: {
            manual: 'Choose every time',
            fixed: 'Fixed directory',
            source: 'Next to source files',
          },
        },
        output_folder_open_on_finish: {
          title: 'Open Output Folder When Finished',
          description: 'When enabled, the output folder will be automatically opened upon task completion',
          options: {
            disabled: 'Off',
            enabled: 'On',
          },
        },
        request_timeout: {
          title: 'Request Timeout',
          description: 'The maximum time (seconds) to wait for response when making a request<br>If no reply is received after the timeout, the task will be considered failed',
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
      fields: {
        response_check_settings: {
          title: 'Result Check Rules',
          description: 'In translation tasks, results is checked based on enabled rules, all enabled by default',
          button: 'Rules',
          options: {
            kana_residue: 'Kana Residue Check',
            hangeul_residue: 'Hangeul Residue Check',
            similarity: 'Similarity Check',
          },
        },
        preceding_lines_threshold: {
          title: 'Preceding Lines Threshold',
          description: 'Maximum number of preceding lines to include as context for each translation task, disabled by default',
        },
        clean_ruby: {
          title: 'Clean Ruby Text',
          description: 'Removes the phonetic ruby characters from annotations, retaining only the main text, disabled by default<br>Phonetic ruby characters are often not understood by the model, cleaning them can improve translation quality<br>Supported ruby formats include, but are not limited to:<br>• (漢字/かんじ) [漢字/かんじ] |漢字[かんじ]<br>• \\r[漢字,かんじ] \\rb[漢字,かんじ] [r_かんじ][ch_漢字] [ch_漢字]<br>• [ruby text=かんじ] [ruby text = かんじ] [ruby text="かんじ"] [ruby text = "かんじ"]',
        },
        deduplication_in_trans: {
          title: 'Deduplicate Repeated Text in T++ Project File',
          description: 'In T++ project file (i.e., <font color=\'darkgoldenrod\'><b>.trans</b></font> file), whether to deduplicate repeated text, enabled by default',
        },
        deduplication_in_bilingual: {
          title: 'Output Only Once if Source and Target are Identical in Bilingual Output Files',
          description: 'In subtitles or e-books, whether to output text only once if the source and target text are identical, enabled by default',
        },
        write_translated_name_fields_to_file: {
          title: 'Write Translated Name Fields to the Output File',
          description: 'In some <font color=\'darkgoldenrod\'><b>GalGame</b></font>, name field data is bound to resource files such as image or voice files<br>Translating these name fields can cause errors. In such cases, this feature can be disabled, enabled by default<br>Supported formats:<br>• RenPy exported game text (.rpy)<br>• VNTextPatch or SExtractor exported game text with name fields (.json)',
        },
        auto_process_prefix_suffix_preserved_text: {
          title: 'Auto Process Prefix/Suffix Preserved Text',
          description: 'Whether to auto-process text segments at the start/end that match preserve rules, enabled by default<br>• Enabled: Removes segments matching preserve rules and restores them after translation<br>• Disabled: Sends the full text for better context, but may reduce preserve effectiveness',
        },
      },
      feedback: {
        retry: 'Retry',
        refresh_failed: 'Unable to refresh expert settings right now. Please try again later.',
        refresh_failed_title: 'Failed to Load Expert Settings',
        update_failed: 'Failed to save the setting. Please try again later.',
      },
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_setting>
