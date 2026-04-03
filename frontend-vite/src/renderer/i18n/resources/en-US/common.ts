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
        subtitle: 'Choose a source file to build an .lg project so the workflow can continue without the source files.',
        drop_title: 'Click or drop source files',
        action: 'Create Project',
      },
      open: {
        title: 'Open Project',
        subtitle: 'Load an existing .lg project to continue with saved progress and translation rules.',
        drop_title: 'Click or drop an .lg file',
        recent_title: 'Recent Projects',
        empty: 'When there are no recent projects yet, an empty onboarding state will appear here.',
        ready_status: 'Project ready',
        action: 'Open Project',
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
        renpy: 'RenPy Exported Script',
        mtool: 'MTool Exported Script',
        sextractor: 'SExtractor Exported Script',
        vntextpatch: 'VNTextPatch Exported Script',
        trans_project: 'Translator++ Project File',
        trans_export: 'Translator++ Exported Script',
        wolf: 'WOLF Official Translation Tool Script',
      },
    },
    model: {
      summary: 'Model management will host provider setup, switching policy, and runtime readiness as the entry point of the desktop workflow.',
    },
  },
  profile: {
    status: 'Ciallo～(∠・ω< )⌒✮',
  },
} satisfies LocaleMessageSchema<typeof zh_cn_common>
