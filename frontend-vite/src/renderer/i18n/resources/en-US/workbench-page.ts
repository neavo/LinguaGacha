import { zh_cn_workbench_page } from '@/i18n/resources/zh-CN/workbench-page'
import type { LocaleMessageSchema } from '@/i18n/types'

export const en_us_workbench_page = {
  title: 'Workbench',
  summary: 'The workbench will gather file lists, progress, and project-level quick actions.',
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
    file_count: 'File Count',
    total_lines: 'Total Lines',
    translated: 'Translated',
    untranslated: 'Untranslated',
  },
  table: {
    drag_handle: 'Drag',
    drag_handle_aria: 'Drag to reorder',
    file_name: 'File Name',
    format: 'Format',
    line_count: 'Line',
    actions: 'Menu',
    open_actions: 'Open actions menu',
  },
  action: {
    add_file: 'Add File',
    export_translation: 'Generate Translation',
    close_project: 'Close Project',
    replace: 'Replace File',
    reset: 'Reset Translation Status',
    delete: 'Delete',
  },
  format: {
    markdown: 'Markdown',
    text_file: 'Plain Text',
    subtitle_file: 'Subtitle File',
    ebook: 'Ebook',
    translation_export: 'Translated Export',
  },
  command: {
    description: 'The bottom command bar carries project-level quick actions.',
  },
  reorder: {
    failed: 'Failed to save the file order. Please try again later.',
  },
  dialog: {
    replace: {
      title: 'Confirm File Replacement',
      description: 'Replacing updates the current file with the new content and keeps the selection whenever possible after refresh.',
      confirm: 'Replace File',
    },
    reset: {
      title: 'Confirm File Reset',
      description: 'Reset restores the file back to its original project content and recalculates the stats.',
      confirm: 'Reset File',
    },
    delete: {
      title: 'Confirm File Deletion',
      description: 'Deleting removes the file from the current project and refreshes the stat cards afterwards.',
      confirm: 'Delete File',
    },
    export: {
      title: 'Confirm Translation Export',
      description: 'Generating will export real translation files with the current project settings.',
      confirm: 'Generate Output',
    },
    close_project: {
      title: 'Confirm Project Close',
      description: 'Closing unloads the current project and sends you back to the project home.',
      confirm: 'Close Project',
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_workbench_page>
