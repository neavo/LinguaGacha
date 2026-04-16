import { zh_cn_workbench_page } from '@/i18n/resources/zh-CN/workbench-page'
import type { LocaleMessageSchema } from '@/i18n/types'

export const en_us_workbench_page = {
  title: 'Workbench',
  section: {
    stats: 'Workbench Stats',
    file_list: 'File List',
    command_bar: 'Workbench Command Bar',
  },
  unit: {
    file: 'File',
    line: 'Line',
  },
  stats: {
    file_count: 'Files',
    total_lines: 'Total Lines',
    translated: 'Translated',
    untranslated: 'Untranslated',
  },
  table: {
    drag_handle: 'Drag',
    drag_handle_aria: 'Drag to reorder',
    file_name: 'File Name',
    format: 'Format',
    line_count: 'Lines',
    actions: 'Actions',
    open_actions: 'Open actions menu',
  },
  sort: {
    ascending: 'Sort ascending',
    descending: 'Sort descending',
    clear: 'Clear sort',
  },
  action: {
    add_file: 'Add File',
    export_translation: 'Generate',
    close_project: 'Close Project',
    replace: 'Replace File',
    reset: 'Reset Translation',
    delete: 'Delete',
  },
  format: {
    markdown: 'Markdown',
    renpy: 'RenPy',
    mtool: 'MTool',
    sextractor: 'VNT/SExtractor',
    trans_project: 'Translator++',
    text_file: 'Plain Text',
    subtitle_file: 'Subtitle File',
    ebook: 'EPUB',
    translation_export: 'Translator++ XLSX',
    wolf: 'WOLF Official Tool XLSX',
  },
  command: {
    description: 'The workbench command bar carries project-level quick actions.',
  },
  reorder: {
    failed: 'Failed to save the file order. Please try again later.',
  },
  dialog: {
    replace: {
      title: 'Confirm',
      description: 'Current translations will be preserved as much as possible',
      confirm: 'Confirm',
    },
    reset: {
      title: 'Confirm',
      description: 'Reset translation status for this file …?',
      confirm: 'Confirm',
    },
    delete: {
      title: 'Confirm',
      description: 'Delete this file and all its translation items …?',
      confirm: 'Confirm',
    },
    export: {
      title: 'Confirm',
      description: 'Confirm to generate the translation file?',
      confirm: 'Confirm',
    },
    close_project: {
      title: 'Confirm',
      description: 'Are you sure you want to close the current project?',
      confirm: 'Confirm',
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_workbench_page>
