import { zh_cn_expert_settings_page } from '@/i18n/resources/zh-CN/expert-settings-page'
import type { LocaleMessageSchema } from '@/i18n/types'

export const en_us_expert_settings_page = {
  title: 'Expert Settings',
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
      description: (
        'Removes the phonetic ruby characters from annotations, retaining only the main text, disabled by default'
        + '\n' + 'Phonetic ruby characters are often not understood by the model, cleaning them can improve translation quality'
        + '\n' + 'Supported ruby formats include, but are not limited to:'
        + '\n' + '• (漢字/かんじ) [漢字/かんじ] |漢字[かんじ]'
        + '\n' + '• \\r[漢字,かんじ] \\rb[漢字,かんじ] [r_かんじ][ch_漢字] [ch_漢字]'
        + '\n' + '• [ruby text=かんじ] [ruby text = かんじ] [ruby text="かんじ"] [ruby text = "かんじ"]'
      ),
    },
    deduplication_in_trans: {
      title: 'Deduplicate Repeated Text in T++ Project File',
      description: 'In T++ project file (i.e., <emphasis>.trans</emphasis> file), whether to deduplicate repeated text, enabled by default',
    },
    deduplication_in_bilingual: {
      title: 'Output Only Once if Source and Target are Identical in Bilingual Output Files',
      description: 'In subtitles or e-books, whether to output text only once if the source and target text are identical, enabled by default',
    },
    write_translated_name_fields_to_file: {
      title: 'Write Translated Name Fields to the Output File',
      description: (
        'In some <emphasis>GalGame</emphasis>, name field data is bound to resource files such as image or voice files'
        + '\n' + 'Translating these name fields can cause errors. In such cases, this feature can be disabled, enabled by default'
        + '\n' + 'Supported formats:'
        + '\n' + '• RenPy exported game text (.rpy)'
        + '\n' + '• VNTextPatch or SExtractor exported game text with name fields (.json)'
      ),
    },
    auto_process_prefix_suffix_preserved_text: {
      title: 'Auto Process Prefix/Suffix Preserved Text',
      description: (
        'Whether to auto-process text segments at the start/end that match preserve rules, enabled by default'
        + '\n' + '• Enabled: Removes segments matching preserve rules and restores them after translation'
        + '\n' + '• Disabled: Sends the full text for better context, but may reduce preserve effectiveness'
      ),
    },
  },
  feedback: {
    retry: 'Retry',
    refresh_failed: 'Unable to refresh expert settings right now. Please try again later.',
    refresh_failed_title: 'Failed to Load Expert Settings',
    update_failed: 'Failed to save the setting. Please try again later.',
  },
} satisfies LocaleMessageSchema<typeof zh_cn_expert_settings_page>
