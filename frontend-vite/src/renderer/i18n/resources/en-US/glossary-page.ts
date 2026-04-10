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
    save: 'Save',
    cancel: 'Cancel',
  },
  toggle: {
    status: '{TITLE} - {STATE}',
    tooltip: 'Build a glossary into prompts to guide translation, keep terminology consistent, and correct character attributes.',
  },
  fields: {
    drag: 'Drag',
    source: 'Source',
    translation: 'Translation',
    description: 'Description',
    rule: 'Rule',
    statistics: 'Statistics',
  },
  statistics: {
    hit_count: 'Matched item count: {COUNT}',
    subset_relations: 'Contains subset relations:',
    action: {
      query_source: 'Query source',
      search_relation: 'Query subset relations',
    },
  },
  rule: {
    case_sensitive: 'Case-sensitive',
  },
  drag: {
    disabled: 'Reordering is disabled while filters are active',
  },
  filter: {
    placeholder: 'Enter keywords …',
    clear: 'Clear',
    regex: 'Regex',
    empty: 'No filtered results',
    invalid: 'Invalid regular expression',
    scope: {
      label: 'Scope',
      all: 'All',
      source: 'Source',
      translation: 'Translation',
      description: 'Notes',
    },
  },
  column_filter: {
    trigger: 'Filter {FIELD}',
    clear: 'Clear filter',
    operator: {
      empty: 'Empty',
    },
    translation: {
      empty_only: 'Only empty translations',
    },
    description: {
      empty_only: 'Only empty notes',
    },
    rule: {
      case_sensitive: 'Case-sensitive',
      case_insensitive: 'Case-insensitive',
    },
    statistics: {
      matched: 'Has matches',
      unmatched: 'No matches',
      related: 'Has relations',
      unavailable: 'Run statistics first',
    },
  },
  empty: {
    title: 'The glossary is empty',
    description: 'Click "Create" to add the first glossary rule, or import an existing glossary file.',
    filtered_title: 'No filtered results',
    filtered_description: 'Try adjusting the keyword, scope, or column filters.',
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
