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
  include_without_glossary_miss: boolean
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

export type ProofreadingClientItem = ProofreadingItem & {
  row_id: string
  compressed_src: string
  compressed_dst: string
}

export type ProofreadingStoreItemRecord = {
  item_id: number | string
  file_path: string
  src: string
  dst: string
  status: string
}

export type ProofreadingSnapshot = {
  revision: number
  project_id: string
  readonly: boolean
  summary: ProofreadingSummary
  filters: ProofreadingFilterOptions
  items: ProofreadingClientItem[]
}

export type ProofreadingMutationResult = {
  revision: number
  changed_item_ids: Array<number | string>
  items: ProofreadingClientItem[]
  summary: ProofreadingSummary
}

export type ProofreadingVisibleItem = {
  row_id: string
  item: ProofreadingClientItem
  compressed_src: string
  compressed_dst: string
}

type ProofreadingPayloadGlossaryTerm =
  | ProofreadingGlossaryTerm
  | { src?: string; dst?: string }

type ProofreadingPayloadItem = Partial<ProofreadingItem> & {
  applied_glossary_terms?: ProofreadingPayloadGlossaryTerm[]
  failed_glossary_terms?: ProofreadingPayloadGlossaryTerm[]
}

type ProofreadingPayloadFilterOptions = Partial<ProofreadingFilterOptions> & {
  glossary_terms?: ProofreadingPayloadGlossaryTerm[]
}

export type ProofreadingSnapshotPayload = {
  snapshot?: {
    revision?: number
    project_id?: string
    readonly?: boolean
    summary?: Partial<ProofreadingSummary>
    filters?: ProofreadingPayloadFilterOptions
    items?: ProofreadingPayloadItem[]
  }
}

export type ProofreadingMutationPayload = {
  result?: {
    revision?: number
    changed_item_ids?: Array<number | string>
    summary?: Partial<ProofreadingSummary>
    items?: ProofreadingPayloadItem[]
  }
}

export type ProofreadingFilePatch = {
  revision: number
  project_id: string
  readonly: boolean
  removed_file_paths: string[]
  default_filters: ProofreadingFilterOptions
  applied_filters: ProofreadingFilterOptions
  full_summary: ProofreadingSummary
  filtered_summary: ProofreadingSummary
  full_items: ProofreadingClientItem[]
  filtered_items: ProofreadingClientItem[]
}

export type ProofreadingFilePatchPayload = {
  patch?: {
    revision?: number
    project_id?: string
    readonly?: boolean
    removed_file_paths?: string[]
    default_filters?: ProofreadingPayloadFilterOptions
    applied_filters?: ProofreadingPayloadFilterOptions
    full_summary?: Partial<ProofreadingSummary>
    filtered_summary?: Partial<ProofreadingSummary>
    full_items?: ProofreadingPayloadItem[]
    filtered_items?: ProofreadingPayloadItem[]
  }
}

export type ProofreadingEntryPatch = {
  revision: number
  project_id: string
  readonly: boolean
  target_item_ids: Array<number | string>
  default_filters: ProofreadingFilterOptions
  applied_filters: ProofreadingFilterOptions
  full_summary: ProofreadingSummary
  filtered_summary: ProofreadingSummary
  full_items: ProofreadingClientItem[]
  filtered_items: ProofreadingClientItem[]
}

export type ProofreadingEntryPatchPayload = {
  patch?: {
    revision?: number
    project_id?: string
    readonly?: boolean
    target_item_ids?: Array<number | string>
    default_filters?: ProofreadingPayloadFilterOptions
    applied_filters?: ProofreadingPayloadFilterOptions
    full_summary?: Partial<ProofreadingSummary>
    filtered_summary?: Partial<ProofreadingSummary>
    full_items?: ProofreadingPayloadItem[]
    filtered_items?: ProofreadingPayloadItem[]
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

export const PROOFREADING_TRANSLATION_TASK_ACTIVE_STATUSES = [
  'REQUEST',
  'RUN',
  'TRANSLATING',
  'STOPPING',
] as const

export type ProofreadingTranslationTaskActionKind =
  | 'reset-all'
  | 'reset-failed'
  | 'stop-translation'

export type ProofreadingTranslationTaskSnapshot = {
  task_type: string
  status: string
  busy: boolean
  request_in_flight_count: number
  line: number
  total_line: number
  processed_line: number
  error_line: number
  total_tokens: number
  total_output_tokens: number
  total_input_tokens: number
  time: number
  start_time: number
}

export type ProofreadingTranslationTaskPayload = {
  task?: Partial<ProofreadingTranslationTaskSnapshot>
}

export type ProofreadingTaskConfirmState = {
  kind: ProofreadingTranslationTaskActionKind
  open: boolean
  submitting: boolean
  awaiting_refresh: boolean
}

export type ProofreadingTranslationTaskMetrics = {
  has_result: boolean
  active: boolean
  stopping: boolean
  completion_ratio: number
  completion_percent: number
  processed_count: number
  success_count: number
  failed_count: number
  remaining_count: number
  elapsed_seconds: number
  remaining_seconds: number
  average_output_speed: number
  input_tokens: number
  output_tokens: number
  request_in_flight_count: number
}

export function build_proofreading_row_id(item_id: number | string): string {
  return String(item_id)
}

export function format_proofreading_glossary_term(
  term: ProofreadingGlossaryTerm,
): string {
  return `${term[0]} -> ${term[1]}`
}

export function create_empty_translation_task_snapshot(): ProofreadingTranslationTaskSnapshot {
  return {
    task_type: 'translation',
    status: 'IDLE',
    busy: false,
    request_in_flight_count: 0,
    line: 0,
    total_line: 0,
    processed_line: 0,
    error_line: 0,
    total_tokens: 0,
    total_output_tokens: 0,
    total_input_tokens: 0,
    time: 0,
    start_time: 0,
  }
}

export function clone_translation_task_snapshot(
  snapshot: ProofreadingTranslationTaskSnapshot,
): ProofreadingTranslationTaskSnapshot {
  return {
    task_type: snapshot.task_type,
    status: snapshot.status,
    busy: snapshot.busy,
    request_in_flight_count: snapshot.request_in_flight_count,
    line: snapshot.line,
    total_line: snapshot.total_line,
    processed_line: snapshot.processed_line,
    error_line: snapshot.error_line,
    total_tokens: snapshot.total_tokens,
    total_output_tokens: snapshot.total_output_tokens,
    total_input_tokens: snapshot.total_input_tokens,
    time: snapshot.time,
    start_time: snapshot.start_time,
  }
}

export function normalize_translation_task_snapshot_payload(
  payload: ProofreadingTranslationTaskPayload,
): ProofreadingTranslationTaskSnapshot {
  const snapshot = payload.task ?? {}
  return {
    task_type: String(snapshot.task_type ?? 'translation'),
    status: String(snapshot.status ?? 'IDLE'),
    busy: Boolean(snapshot.busy),
    request_in_flight_count: Number(snapshot.request_in_flight_count ?? 0),
    line: Number(snapshot.line ?? 0),
    total_line: Number(snapshot.total_line ?? 0),
    processed_line: Number(snapshot.processed_line ?? 0),
    error_line: Number(snapshot.error_line ?? 0),
    total_tokens: Number(snapshot.total_tokens ?? 0),
    total_output_tokens: Number(snapshot.total_output_tokens ?? 0),
    total_input_tokens: Number(snapshot.total_input_tokens ?? 0),
    time: Number(snapshot.time ?? 0),
    start_time: Number(snapshot.start_time ?? 0),
  }
}

export function is_active_translation_task_status(status: string): boolean {
  return PROOFREADING_TRANSLATION_TASK_ACTIVE_STATUSES.includes(
    status as (typeof PROOFREADING_TRANSLATION_TASK_ACTIVE_STATUSES)[number],
  )
}

export function has_translation_task_progress(
  snapshot: ProofreadingTranslationTaskSnapshot | null,
): boolean {
  if (snapshot === null) {
    return false
  }

  const processed_count = snapshot.processed_line > 0
    ? snapshot.processed_line
    : snapshot.line

  return snapshot.line > 0
    || snapshot.total_line > 0
    || processed_count > 0
    || snapshot.error_line > 0
    || snapshot.total_output_tokens > 0
    || snapshot.total_input_tokens > 0
    || snapshot.total_tokens > 0
}

export function resolve_translation_task_display_snapshot(args: {
  current_snapshot: ProofreadingTranslationTaskSnapshot
  last_snapshot: ProofreadingTranslationTaskSnapshot | null
}): ProofreadingTranslationTaskSnapshot | null {
  if (is_active_translation_task_status(args.current_snapshot.status)) {
    return args.current_snapshot
  }

  if (has_translation_task_progress(args.last_snapshot)) {
    return args.last_snapshot
  }

  if (has_translation_task_progress(args.current_snapshot)) {
    return args.current_snapshot
  }

  return null
}

export function resolve_translation_task_metrics(args: {
  snapshot: ProofreadingTranslationTaskSnapshot | null
  now_seconds: number
}): ProofreadingTranslationTaskMetrics {
  if (args.snapshot === null) {
    return {
      has_result: false,
      active: false,
      stopping: false,
      completion_ratio: 0,
      completion_percent: 0,
      processed_count: 0,
      success_count: 0,
      failed_count: 0,
      remaining_count: 0,
      elapsed_seconds: 0,
      remaining_seconds: 0,
      average_output_speed: 0,
      input_tokens: 0,
      output_tokens: 0,
      request_in_flight_count: 0,
    }
  }

  const active = is_active_translation_task_status(args.snapshot.status)
  const stopping = args.snapshot.status === 'STOPPING'
  const processed_count = args.snapshot.processed_line > 0
    ? args.snapshot.processed_line
    : args.snapshot.line
  const failed_count = Math.max(0, args.snapshot.error_line)
  const success_count = Math.max(0, processed_count)
  const remaining_count = Math.max(0, args.snapshot.total_line - args.snapshot.line)
  const completion_ratio = args.snapshot.total_line <= 0
    ? 0
    : Math.min(1, Math.max(0, args.snapshot.line / Math.max(1, args.snapshot.total_line)))
  const elapsed_seconds = active && args.snapshot.start_time > 0
    ? Math.max(0, args.now_seconds - args.snapshot.start_time)
    : Math.max(0, args.snapshot.time)
  const remaining_seconds = args.snapshot.line <= 0
    ? 0
    : Math.max(
        0,
        (elapsed_seconds / Math.max(1, args.snapshot.line))
          * Math.max(0, args.snapshot.total_line - args.snapshot.line),
      )
  const input_tokens = args.snapshot.total_input_tokens > 0
    ? args.snapshot.total_input_tokens
    : Math.max(0, args.snapshot.total_tokens - args.snapshot.total_output_tokens)
  const output_tokens = Math.max(0, args.snapshot.total_output_tokens)
  const average_output_speed = elapsed_seconds <= 0
    ? 0
    : output_tokens / Math.max(1, elapsed_seconds)

  return {
    has_result: true,
    active,
    stopping,
    completion_ratio,
    completion_percent: completion_ratio * 100,
    processed_count,
    success_count,
    failed_count,
    remaining_count,
    elapsed_seconds,
    remaining_seconds,
    average_output_speed,
    input_tokens,
    output_tokens,
    request_in_flight_count: Math.max(0, args.snapshot.request_in_flight_count),
  }
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

export function clone_proofreading_item(item: ProofreadingClientItem): ProofreadingClientItem {
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
    row_id: item.row_id,
    compressed_src: item.compressed_src,
    compressed_dst: item.compressed_dst,
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
    include_without_glossary_miss: filters.include_without_glossary_miss,
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
    include_without_glossary_miss: true,
  }
}

export function normalize_proofreading_filter_options(
  filters: Partial<ProofreadingFilterOptions> | undefined,
  items: ProofreadingItem[],
): ProofreadingFilterOptions {
  const fallback_filters = build_default_proofreading_filter_options(items)
  const has_warning_types = Array.isArray(filters?.warning_types)
  const has_statuses = Array.isArray(filters?.statuses)
  const has_file_paths = Array.isArray(filters?.file_paths)
  const has_glossary_terms = Array.isArray(filters?.glossary_terms)
  const has_include_without_glossary_miss =
    typeof filters?.include_without_glossary_miss === 'boolean'
  const warning_types = has_warning_types
    ? unique_strings((filters?.warning_types ?? []).map((value) => String(value)))
    : []
  const statuses = has_statuses
    ? unique_strings((filters?.statuses ?? []).map((value) => String(value)))
    : []
  const file_paths = has_file_paths
    ? unique_strings((filters?.file_paths ?? []).map((value) => String(value)))
    : []
  const glossary_terms = has_glossary_terms
    ? normalize_glossary_terms(filters?.glossary_terms)
    : []

  return {
    warning_types: has_warning_types ? warning_types : fallback_filters.warning_types,
    statuses: has_statuses ? statuses : fallback_filters.statuses,
    file_paths: has_file_paths ? file_paths : fallback_filters.file_paths,
    glossary_terms: has_glossary_terms ? glossary_terms : fallback_filters.glossary_terms,
    include_without_glossary_miss: has_include_without_glossary_miss
      ? Boolean(filters?.include_without_glossary_miss)
      : fallback_filters.include_without_glossary_miss,
  }
}

function normalize_proofreading_item(
  item: Partial<ProofreadingItem> & {
    applied_glossary_terms?: Array<ProofreadingGlossaryTerm | { src?: string; dst?: string }>
    failed_glossary_terms?: Array<ProofreadingGlossaryTerm | { src?: string; dst?: string }>
  },
): ProofreadingClientItem {
  const normalized_item: ProofreadingItem = {
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

  return {
    ...normalized_item,
    row_id: build_proofreading_row_id(normalized_item.item_id),
    compressed_src: compress_proofreading_text(normalized_item.src),
    compressed_dst: compress_proofreading_text(normalized_item.dst),
  }
}

function normalize_proofreading_items(
  items: Array<Partial<ProofreadingItem> & {
    applied_glossary_terms?: Array<ProofreadingGlossaryTerm | { src?: string; dst?: string }>
    failed_glossary_terms?: Array<ProofreadingGlossaryTerm | { src?: string; dst?: string }>
  }> | undefined,
): ProofreadingClientItem[] {
  return Array.isArray(items)
    ? items.map((item) => normalize_proofreading_item(item))
    : []
}

export function normalize_proofreading_snapshot_payload(
  payload: ProofreadingSnapshotPayload,
): ProofreadingSnapshot {
  const snapshot = payload.snapshot ?? {}
  const items = normalize_proofreading_items(snapshot.items)

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
  const items = normalize_proofreading_items(result.items)
  return {
    revision: Number(result.revision ?? 0),
    changed_item_ids: Array.isArray(result.changed_item_ids)
      ? result.changed_item_ids
      : [],
    items,
    summary: normalize_proofreading_summary(result.summary),
  }
}

export function normalize_proofreading_file_patch_payload(
  payload: ProofreadingFilePatchPayload,
): ProofreadingFilePatch {
  const patch = payload.patch ?? {}
  const full_items = normalize_proofreading_items(patch.full_items)
  const filtered_items = normalize_proofreading_items(patch.filtered_items)

  return {
    revision: Number(patch.revision ?? 0),
    project_id: String(patch.project_id ?? ''),
    readonly: Boolean(patch.readonly),
    removed_file_paths: Array.isArray(patch.removed_file_paths)
      ? unique_strings(patch.removed_file_paths.map((file_path) => String(file_path)))
      : [],
    default_filters: normalize_proofreading_filter_options(
      patch.default_filters,
      full_items,
    ),
    applied_filters: normalize_proofreading_filter_options(
      patch.applied_filters,
      filtered_items,
    ),
    full_summary: normalize_proofreading_summary(patch.full_summary),
    filtered_summary: normalize_proofreading_summary(patch.filtered_summary),
    full_items,
    filtered_items,
  }
}

export function normalize_proofreading_entry_patch_payload(
  payload: ProofreadingEntryPatchPayload,
): ProofreadingEntryPatch {
  const patch = payload.patch ?? {}
  const full_items = normalize_proofreading_items(patch.full_items)
  const filtered_items = normalize_proofreading_items(patch.filtered_items)

  return {
    revision: Number(patch.revision ?? 0),
    project_id: String(patch.project_id ?? ''),
    readonly: Boolean(patch.readonly),
    target_item_ids: Array.isArray(patch.target_item_ids)
      ? patch.target_item_ids
      : [],
    default_filters: normalize_proofreading_filter_options(
      patch.default_filters,
      full_items,
    ),
    applied_filters: normalize_proofreading_filter_options(
      patch.applied_filters,
      filtered_items,
    ),
    full_summary: normalize_proofreading_summary(patch.full_summary),
    filtered_summary: normalize_proofreading_summary(patch.filtered_summary),
    full_items,
    filtered_items,
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
      include_without_glossary_miss: true,
    },
    items: [],
  }
}
