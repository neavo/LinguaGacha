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
    loading: 'Loading',
    select_file: 'Select File',
    select_folder: 'Select Folder',
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
    home: {
      eyebrow: 'Project Home / ProjectPage',
      title: 'Project Home',
      summary: 'This hidden landing screen mirrors the desktop fallback view with create, open, and recent project entry points.',
      create: {
        title: 'Create Project',
        subtitle: 'Choose a file to create an .lg project for later work.',
        drop_title: 'Click or drag files',
        ready_status: '{COUNT} importable files found',
        checking: 'Checking source files…',
        unavailable: 'No importable files were found in this path. Please choose another one.',
        action: 'Create Project',
      },
      open: {
        title: 'Open Project',
        subtitle: 'Open an .lg project and continue from saved progress.',
        drop_title: 'Click or drag files',
        recent_title: 'Recent Projects',
        empty: 'No valid data ...',
        ready_status: 'Project ready',
        preview_loading: 'Reading project preview…',
        preview_unavailable: 'The preview is unavailable right now. Please choose another .lg file.',
        action: 'Open Project',
        remove_recent_project: 'Remove recent project entry',
        remove_unavailable: 'Unable to remove this recent project entry right now. Please try again later.',
        missing_file_title: 'File Not Found',
        missing_file_description: 'This recent project file is no longer available. Remove it from the recent list?',
        missing_file_confirm: 'Remove Entry',
      },
      preview: {
        file_count: 'File Count',
        created_at: 'Created At',
        updated_at: 'Last Modified',
        progress: 'Progress',
        translated: 'Translated:',
        total: 'Total:',
        rows_unit: 'rows',
      },
      formats: {
        title: 'Supported Formats',
        subtitle_bundle: 'Subtitle / Ebook / Markdown',
        renpy: 'RenPy Script',
        mtool: 'MTool Script',
        sextractor: 'SExtractor Script',
        vntextpatch: 'VNTextPatch Script',
        trans_project: 'Translator++ Project',
        trans_export: 'Translator++ Export',
        wolf: 'WOLF Offcial Tool Export',
      },
      drop_multiple_unavailable: 'Dropping multiple files at once is not supported.',
    },
    model: {
      summary: 'Model management will host provider setup, switching policy, and runtime readiness as the entry point of the desktop workflow.',
    },
  },
  profile: {
    status: 'Ciallo～(∠・ω< )⌒✮',
  },
} satisfies LocaleMessageSchema<typeof zh_cn_common>
