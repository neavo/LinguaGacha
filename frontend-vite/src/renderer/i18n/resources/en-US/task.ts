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
        file_name: 'File Name',
        format: 'Format',
        line_count: 'Lines',
        actions: 'Actions',
        open_actions: 'Open actions menu',
      },
      action: {
        add_file: 'Add File',
        export_translation: 'Generate Translation',
        close_project: 'Close Project',
        replace: 'Replace',
        reset: 'Reset',
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
      dialog: {
        cancel: 'Cancel',
        replace: {
          title: 'Confirm File Replacement',
          description: 'Replacing keeps the row selected while updating the current entry with the new mock file.',
          confirm: 'Replace File',
        },
        reset: {
          title: 'Confirm File Reset',
          description: 'Reset restores the selected file back to its initial mock state for desktop parity.',
          confirm: 'Reset File',
        },
        delete: {
          title: 'Confirm File Deletion',
          description: 'Deleting removes the file from the workbench immediately and recalculates the stat cards.',
          confirm: 'Delete File',
        },
        export: {
          title: 'Confirm Translation Export',
          description: 'This mock only reproduces the confirmation flow and does not write any files yet.',
          confirm: 'Generate Output',
        },
        close_project: {
          title: 'Confirm Project Close',
          description: 'Closing switches the workbench into the unloaded and read-only mock state.',
          confirm: 'Close Project',
        },
      },
      empty: {
        title: 'Project Not Loaded',
        description: 'Load a project before managing files, generating translation output, or closing the project.',
      },
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_task>
