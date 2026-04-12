export const PROOFREADING_NO_WARNING_CODE = 'NO_WARNING' as const

export const PROOFREADING_WARNING_CODES = [
  PROOFREADING_NO_WARNING_CODE,
  'KANA',
  'HANGEUL',
  'TEXT_PRESERVE',
  'SIMILARITY',
  'GLOSSARY',
  'RETRY_THRESHOLD',
] as const

export const PROOFREADING_DEFAULT_ACTIVE_STATUS_CODES = [
  'NONE',
  'PROCESSED',
  'ERROR',
  'PROCESSED_IN_PAST',
] as const

export const PROOFREADING_FILTER_SOURCE_EXCLUDED_STATUS_CODES = [
  'DUPLICATED',
  'RULE_SKIPPED',
] as const

export const PROOFREADING_STATUS_ORDER = [
  'NONE',
  'PROCESSED',
  'PROCESSED_IN_PAST',
  'ERROR',
  'EXCLUDED',
  'LANGUAGE_SKIPPED',
] as const

export const PROOFREADING_STATUS_LABEL_KEY_BY_CODE = {
  NONE: 'proofreading_page.status.none',
  PROCESSED: 'proofreading_page.status.processed',
  PROCESSED_IN_PAST: 'proofreading_page.status.processed_in_past',
  ERROR: 'proofreading_page.status.error',
  EXCLUDED: 'proofreading_page.status.excluded',
  LANGUAGE_SKIPPED: 'proofreading_page.status.non_target_source_language',
} as const

export const PROOFREADING_WARNING_LABEL_KEY_BY_CODE = {
  KANA: 'proofreading_page.warning.kana',
  HANGEUL: 'proofreading_page.warning.hangeul',
  TEXT_PRESERVE: 'proofreading_page.warning.text_preserve',
  SIMILARITY: 'proofreading_page.warning.similarity',
  GLOSSARY: 'proofreading_page.warning.glossary',
  RETRY_THRESHOLD: 'proofreading_page.warning.retry_threshold',
  NO_WARNING: 'proofreading_page.filter.no_warning',
} as const

export type ProofreadingKnownWarningCode = (typeof PROOFREADING_WARNING_CODES)[number]
export type ProofreadingGlossaryTerm = readonly [string, string]

export type ProofreadingSummary = {
  total_items: number
  filtered_items: number
  warning_items: number
}

export type ProofreadingFilterOptions = {
  warning_types: string[]
  statuses: string[]
  file_paths: string[]
  glossary_terms: ProofreadingGlossaryTerm[]
}

export type ProofreadingItem = {
  item_id: number | string
  file_path: string
  row_number: number
  src: string
  dst: string
  status: string
  warnings: string[]
  applied_glossary_terms: ProofreadingGlossaryTerm[]
  failed_glossary_terms: ProofreadingGlossaryTerm[]
}

export type ProofreadingSnapshot = {
  revision: number
  project_id: string
  readonly: boolean
  summary: ProofreadingSummary
  filters: ProofreadingFilterOptions
  items: ProofreadingItem[]
}

export type ProofreadingMutationResult = {
  revision: number
  changed_item_ids: Array<number | string>
  items: ProofreadingItem[]
  summary: ProofreadingSummary
}

export type ProofreadingVisibleItem = {
  row_id: string
  item: ProofreadingItem
  compressed_src: string
  compressed_dst: string
}

export type ProofreadingSnapshotPayload = {
  snapshot?: Partial<ProofreadingSnapshot> & {
    summary?: Partial<ProofreadingSummary>
    filters?: Partial<ProofreadingFilterOptions> & {
      glossary_terms?: Array<ProofreadingGlossaryTerm | { src?: string; dst?: string }>
    }
    items?: Array<Partial<ProofreadingItem> & {
      applied_glossary_terms?: Array<ProofreadingGlossaryTerm | { src?: string; dst?: string }>
      failed_glossary_terms?: Array<ProofreadingGlossaryTerm | { src?: string; dst?: string }>
    }>
  }
}

export type ProofreadingMutationPayload = {
  result?: Partial<ProofreadingMutationResult> & {
    summary?: Partial<ProofreadingSummary>
    items?: Array<Partial<ProofreadingItem> & {
      applied_glossary_terms?: Array<ProofreadingGlossaryTerm | { src?: string; dst?: string }>
      failed_glossary_terms?: Array<ProofreadingGlossaryTerm | { src?: string; dst?: string }>
    }>
  }
}

export type ProofreadingDialogState = {
  open: boolean
  target_row_id: string | null
  draft_dst: string
  saving: boolean
}

export type ProofreadingPendingMutationKind =
  | 'replace-all'
  | 'retranslate-items'
  | 'reset-items'

export type ProofreadingSearchScope =
  | 'all'
  | 'src'
  | 'dst'

export type ProofreadingPendingMutation = {
  kind: ProofreadingPendingMutationKind
  target_row_ids: string[]
}

export function build_proofreading_row_id(item_id: number | string): string {
  return String(item_id)
}

export function resolve_proofreading_status_sort_rank(status: string): number {
  const known_index = PROOFREADING_STATUS_ORDER.indexOf(
    status as (typeof PROOFREADING_STATUS_ORDER)[number],
  )
  return known_index >= 0 ? known_index : PROOFREADING_STATUS_ORDER.length
}

export function compress_proofreading_text(text: string): string {
  return text.replace(/\r\n|\r|\n/gu, ' ↵ ')
}

export function clone_proofreading_item(item: ProofreadingItem): ProofreadingItem {
  return {
    item_id: item.item_id,
    file_path: item.file_path,
    row_number: item.row_number,
    src: item.src,
    dst: item.dst,
    status: item.status,
    warnings: [...item.warnings],
    applied_glossary_terms: item.applied_glossary_terms.map((term) => {
      return [term[0], term[1]] as const
    }),
    failed_glossary_terms: item.failed_glossary_terms.map((term) => {
      return [term[0], term[1]] as const
    }),
  }
}

export function clone_proofreading_filter_options(
  filters: ProofreadingFilterOptions,
): ProofreadingFilterOptions {
  return {
    warning_types: [...filters.warning_types],
    statuses: [...filters.statuses],
    file_paths: [...filters.file_paths],
    glossary_terms: filters.glossary_terms.map((term) => {
      return [term[0], term[1]] as const
    }),
  }
}

export function create_empty_proofreading_summary(): ProofreadingSummary {
  return {
    total_items: 0,
    filtered_items: 0,
    warning_items: 0,
  }
}

export function resolve_proofreading_filter_source_items(
  items: ProofreadingItem[],
): ProofreadingItem[] {
  const excluded_status_set = new Set<string>(PROOFREADING_FILTER_SOURCE_EXCLUDED_STATUS_CODES)
  return items.filter((item) => !excluded_status_set.has(item.status))
}

function normalize_proofreading_summary(
  summary: Partial<ProofreadingSummary> | undefined,
): ProofreadingSummary {
  return {
    total_items: Number(summary?.total_items ?? 0),
    filtered_items: Number(summary?.filtered_items ?? 0),
    warning_items: Number(summary?.warning_items ?? 0),
  }
}

function normalize_glossary_terms(
  glossary_terms: Array<ProofreadingGlossaryTerm | { src?: string; dst?: string }> | undefined,
): ProofreadingGlossaryTerm[] {
  if (!Array.isArray(glossary_terms)) {
    return []
  }

  return glossary_terms
    .map((term) => {
      if (Array.isArray(term) && term.length >= 2) {
        return [String(term[0] ?? ''), String(term[1] ?? '')] as const
      }

      if (typeof term === 'object' && term !== null && !Array.isArray(term)) {
        const term_record = term as { src?: string; dst?: string }
        return [String(term_record.src ?? ''), String(term_record.dst ?? '')] as const
      }

      return null
    })
    .filter((term): term is ProofreadingGlossaryTerm => {
      return term !== null && (term[0] !== '' || term[1] !== '')
    })
}

function unique_strings(values: string[]): string[] {
  return [...new Set(values)]
}

function build_default_proofreading_filter_options(
  items: ProofreadingItem[],
): ProofreadingFilterOptions {
  const source_items = resolve_proofreading_filter_source_items(items)
  const available_statuses = unique_strings(source_items.map((item) => item.status))
  const default_statuses = available_statuses.filter((status) => {
    return PROOFREADING_DEFAULT_ACTIVE_STATUS_CODES.includes(
      status as (typeof PROOFREADING_DEFAULT_ACTIVE_STATUS_CODES)[number],
    )
  })
  const available_warning_types = new Set<string>([PROOFREADING_NO_WARNING_CODE])
  const available_file_paths = new Set<string>()
  const available_glossary_terms = new Map<string, ProofreadingGlossaryTerm>()

  source_items.forEach((item) => {
    available_file_paths.add(item.file_path)

    if (item.warnings.length === 0) {
      available_warning_types.add(PROOFREADING_NO_WARNING_CODE)
    } else {
      item.warnings.forEach((warning) => {
        available_warning_types.add(warning)
      })
    }

    item.failed_glossary_terms.forEach((term) => {
      available_glossary_terms.set(`${term[0]}→${term[1]}`, term)
    })
  })

  return {
    warning_types: [...available_warning_types],
    statuses: default_statuses.length > 0 ? default_statuses : available_statuses,
    file_paths: [...available_file_paths],
    glossary_terms: [...available_glossary_terms.values()],
  }
}

export function normalize_proofreading_filter_options(
  filters: Partial<ProofreadingFilterOptions> | undefined,
  items: ProofreadingItem[],
): ProofreadingFilterOptions {
  const fallback_filters = build_default_proofreading_filter_options(items)
  const warning_types = Array.isArray(filters?.warning_types)
    ? unique_strings(filters.warning_types.map((value) => String(value)))
    : []
  const statuses = Array.isArray(filters?.statuses)
    ? unique_strings(filters.statuses.map((value) => String(value)))
    : []
  const file_paths = Array.isArray(filters?.file_paths)
    ? unique_strings(filters.file_paths.map((value) => String(value)))
    : []
  const glossary_terms = normalize_glossary_terms(filters?.glossary_terms)

  return {
    warning_types: warning_types.length > 0 ? warning_types : fallback_filters.warning_types,
    statuses: statuses.length > 0 ? statuses : fallback_filters.statuses,
    file_paths: file_paths.length > 0 ? file_paths : fallback_filters.file_paths,
    glossary_terms: glossary_terms.length > 0 ? glossary_terms : fallback_filters.glossary_terms,
  }
}

function normalize_proofreading_item(
  item: Partial<ProofreadingItem> & {
    applied_glossary_terms?: Array<ProofreadingGlossaryTerm | { src?: string; dst?: string }>
    failed_glossary_terms?: Array<ProofreadingGlossaryTerm | { src?: string; dst?: string }>
  },
): ProofreadingItem {
  return {
    item_id: item.item_id ?? 0,
    file_path: String(item.file_path ?? ''),
    row_number: Number(item.row_number ?? 0),
    src: String(item.src ?? ''),
    dst: String(item.dst ?? ''),
    status: String(item.status ?? ''),
    warnings: Array.isArray(item.warnings)
      ? unique_strings(item.warnings.map((warning) => String(warning)))
      : [],
    applied_glossary_terms: normalize_glossary_terms(item.applied_glossary_terms),
    failed_glossary_terms: normalize_glossary_terms(item.failed_glossary_terms),
  }
}

export function normalize_proofreading_snapshot_payload(
  payload: ProofreadingSnapshotPayload,
): ProofreadingSnapshot {
  const snapshot = payload.snapshot ?? {}
  const items = Array.isArray(snapshot.items)
    ? snapshot.items.map((item) => normalize_proofreading_item(item))
    : []

  return {
    revision: Number(snapshot.revision ?? 0),
    project_id: String(snapshot.project_id ?? ''),
    readonly: Boolean(snapshot.readonly),
    summary: normalize_proofreading_summary(snapshot.summary),
    filters: normalize_proofreading_filter_options(snapshot.filters, items),
    items,
  }
}

export function normalize_proofreading_mutation_payload(
  payload: ProofreadingMutationPayload,
): ProofreadingMutationResult {
  const result = payload.result ?? {}
  return {
    revision: Number(result.revision ?? 0),
    changed_item_ids: Array.isArray(result.changed_item_ids)
      ? result.changed_item_ids
      : [],
    items: Array.isArray(result.items)
      ? result.items.map((item) => normalize_proofreading_item(item))
      : [],
    summary: normalize_proofreading_summary(result.summary),
  }
}

export function create_empty_proofreading_snapshot(): ProofreadingSnapshot {
  return {
    revision: 0,
    project_id: '',
    readonly: false,
    summary: create_empty_proofreading_summary(),
    filters: {
      warning_types: [],
      statuses: [],
      file_paths: [],
      glossary_terms: [],
    },
    items: [],
  }
}
