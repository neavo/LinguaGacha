import { zh_cn_glossary_page } from '@/i18n/resources/zh-CN/glossary-page'
import type { LocaleMessageSchema } from '@/i18n/types'

export const en_us_glossary_page = {
  title: 'Glossary',
  summary: 'Build a glossary into prompts to guide translation, keep terminology consistent, and correct character attributes.',
  action: {
    create: 'Create',
    import: 'Import',
    export: 'Export',
    statistics: 'Statistics',
    preset: 'Presets',
    edit: 'Edit',
    delete: 'Delete',
    query: 'Query',
    save: 'Save',
    cancel: 'Cancel',
  },
  toggle: {
    tooltip: 'Build a glossary into prompts to guide translation, keep terminology consistent, and correct character attributes.',
  },
  fields: {
    source: 'Source',
    translation: 'Translation',
    description: 'Description',
    rule: 'Rule',
    status: 'Status',
  },
  rule: {
    case_sensitive: 'Case-sensitive',
    toggle_case_sensitive: 'Toggle case-sensitive matching',
  },
  search: {
    regex: 'Regex',
    placeholder: 'Search glossary …',
    execute: 'Focus match',
    previous: 'Previous',
    next: 'Next',
    empty: 'No matches found',
    invalid: 'Invalid regular expression',
  },
  empty: {
    title: 'The glossary is empty',
    description: 'Click "Create" to add the first glossary rule, or import an existing glossary file.',
  },
  dialog: {
    create_title: 'Create glossary entry',
    edit_title: 'Edit glossary entry',
  },
  preset: {
    empty: 'No presets available',
  },
  feedback: {
    refresh_failed: 'Failed to refresh the glossary.',
    save_failed: 'Failed to save the glossary.',
    import_failed: 'Failed to import the glossary.',
    export_failed: 'Failed to export the glossary.',
    statistics_failed: 'Failed to build glossary statistics.',
    preset_failed: 'Failed to load glossary presets.',
    query_failed: 'Failed to query proofreading.',
    source_required: 'Source text is required.',
  },
} satisfies LocaleMessageSchema<typeof zh_cn_glossary_page>
