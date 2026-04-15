import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { DesktopApiError, api_fetch } from '@/app/desktop-api'
import { useAppNavigation } from '@/app/navigation/navigation-context'
import { useDesktopRuntime } from '@/app/state/use-desktop-runtime'
import { useDesktopToast } from '@/app/state/use-desktop-toast'
import { useI18n } from '@/i18n'
import type { AppTableSelectionChange, AppTableSortState } from '@/widgets/app-table/app-table-types'
import {
  build_proofreading_row_id,
  clone_proofreading_filter_options,
  clone_translation_task_snapshot,
  compress_proofreading_text,
  create_empty_proofreading_snapshot,
  create_empty_translation_task_snapshot,
  has_translation_task_progress,
  is_active_translation_task_status,
  normalize_proofreading_mutation_payload,
  normalize_proofreading_snapshot_payload,
  normalize_translation_task_snapshot_payload,
  resolve_proofreading_status_sort_rank,
  resolve_translation_task_display_snapshot,
  resolve_translation_task_metrics,
  type ProofreadingDialogState,
  type ProofreadingFilterOptions,
  type ProofreadingGlossaryTerm,
  type ProofreadingItem,
  type ProofreadingMutationPayload,
  type ProofreadingPendingMutation,
  type ProofreadingSearchScope,
  type ProofreadingSnapshot,
  type ProofreadingSnapshotPayload,
  type ProofreadingTaskConfirmState,
  type ProofreadingTranslationTaskActionKind,
  type ProofreadingTranslationTaskMetrics,
  type ProofreadingTranslationTaskPayload,
  type ProofreadingTranslationTaskSnapshot,
  type ProofreadingVisibleItem,
} from '@/pages/proofreading-page/types'

type UseProofreadingPageStateResult = {
  refresh_error: string | null
  is_refreshing: boolean
  is_mutating: boolean
  readonly: boolean
  search_keyword: string
  replace_text: string
  search_scope: ProofreadingSearchScope
  is_regex: boolean
  invalid_regex_message: string | null
  full_snapshot: ProofreadingSnapshot
  server_snapshot: ProofreadingSnapshot
  current_filters: ProofreadingFilterOptions
  visible_items: ProofreadingVisibleItem[]
  sort_state: AppTableSortState | null
  selected_row_ids: string[]
  active_row_id: string | null
  anchor_row_id: string | null
  filter_dialog_open: boolean
  dialog_state: ProofreadingDialogState
  dialog_item: ProofreadingItem | null
  pending_mutation: ProofreadingPendingMutation | null
  translation_task_snapshot: ProofreadingTranslationTaskSnapshot
  last_translation_task_snapshot: ProofreadingTranslationTaskSnapshot | null
  translation_task_display_snapshot: ProofreadingTranslationTaskSnapshot | null
  translation_task_metrics: ProofreadingTranslationTaskMetrics
  translation_waveform_history: number[]
  translation_detail_sheet_open: boolean
  task_confirm_state: ProofreadingTaskConfirmState | null
  translation_task_menu_disabled: boolean
  translation_task_menu_busy: boolean
  can_open_translation_detail_sheet: boolean
  refresh_snapshot: () => Promise<void>
  update_search_keyword: (next_keyword: string) => void
  update_replace_text: (next_replace_text: string) => void
  update_search_scope: (next_scope: ProofreadingSearchScope) => void
  update_regex: (next_is_regex: boolean) => void
  apply_table_selection: (payload: AppTableSelectionChange) => void
  apply_table_sort_state: (next_sort_state: AppTableSortState | null) => void
  open_filter_dialog: () => void
  close_filter_dialog: () => void
  apply_filter_options: (next_filters: ProofreadingFilterOptions) => Promise<void>
  open_edit_dialog: (row_id: string) => void
  request_close_dialog: () => void
  update_dialog_draft: (next_draft_dst: string) => void
  save_dialog_entry: () => Promise<void>
  replace_next_visible_match: () => Promise<void>
  replace_all_visible_matches: () => Promise<void>
  request_retranslate_row_ids: (row_ids: string[]) => void
  request_reset_row_ids: (row_ids: string[]) => void
  confirm_pending_mutation: () => Promise<void>
  close_pending_mutation: () => void
  open_translation_detail_sheet: () => void
  close_translation_detail_sheet: () => void
  request_start_or_continue_translation: () => Promise<void>
  request_task_action_confirmation: (kind: ProofreadingTranslationTaskActionKind) => void
  confirm_task_action: () => Promise<void>
  close_task_action_confirmation: () => void
}

type ProofreadingTaskCommandPayload = {
  accepted?: boolean
  task?: Partial<ProofreadingTranslationTaskSnapshot>
}

const TRANSLATION_TASK_LIVE_TICK_MS = 1000
const TRANSLATION_WAVEFORM_MAX_POINTS = 72

function create_empty_dialog_state(): ProofreadingDialogState {
  return {
    open: false,
    target_row_id: null,
    draft_dst: '',
    saving: false,
  }
}

function escape_regular_expression(source_text: string): string {
  return source_text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function resolve_error_message(error: unknown, fallback_message: string): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message
  }

  return fallback_message
}

function serialize_glossary_terms(glossary_terms: ProofreadingGlossaryTerm[]): string[][] {
  return glossary_terms.map((term) => [term[0], term[1]])
}

function serialize_filter_options(filters: ProofreadingFilterOptions): Record<string, unknown> {
  return {
    warning_types: [...filters.warning_types],
    statuses: [...filters.statuses],
    file_paths: [...filters.file_paths],
    glossary_terms: serialize_glossary_terms(filters.glossary_terms),
  }
}

function serialize_item(item: ProofreadingItem): Record<string, unknown> {
  return {
    // 为什么：校对接口落到 core 时会反序列化成 `Item`，这里必须传标准字段名，避免被误判成新条目。
    id: item.item_id,
    file_path: item.file_path,
    row: item.row_number,
    src: item.src,
    dst: item.dst,
    status: item.status,
    warnings: [...item.warnings],
    failed_glossary_terms: serialize_glossary_terms(item.failed_glossary_terms),
  }
}

function create_search_pattern(keyword: string, is_regex: boolean): RegExp | null {
  const normalized_keyword = keyword.trim()
  if (normalized_keyword === '') {
    return null
  }

  if (is_regex) {
    return new RegExp(normalized_keyword, 'iu')
  }

  return new RegExp(escape_regular_expression(normalized_keyword), 'iu')
}

function matches_search_pattern(
  text: string,
  search_pattern: RegExp | null,
  keyword: string,
  is_regex: boolean,
): boolean {
  const normalized_keyword = keyword.trim()
  if (normalized_keyword === '') {
    return true
  }

  if (search_pattern === null) {
    return true
  }

  if (is_regex) {
    return search_pattern.test(text)
  }

  return text.toLocaleLowerCase().includes(normalized_keyword.toLocaleLowerCase())
}

function matches_proofreading_search_scope(args: {
  item: ProofreadingItem
  search_pattern: RegExp | null
  keyword: string
  is_regex: boolean
  scope: ProofreadingSearchScope
}): boolean {
  if (args.scope === 'src') {
    return matches_search_pattern(
      args.item.src,
      args.search_pattern,
      args.keyword,
      args.is_regex,
    )
  } else if (args.scope === 'dst') {
    return matches_search_pattern(
      args.item.dst,
      args.search_pattern,
      args.keyword,
      args.is_regex,
    )
  } else {
    return matches_search_pattern(
      args.item.src,
      args.search_pattern,
      args.keyword,
      args.is_regex,
    ) || matches_search_pattern(
      args.item.dst,
      args.search_pattern,
      args.keyword,
      args.is_regex,
    )
  }
}

function replace_first_visible_match(
  text: string,
  search_pattern: RegExp,
  replacement: string,
): { text: string; replaced: boolean } {
  const replaced_text = text.replace(search_pattern, replacement)
  return {
    text: replaced_text,
    replaced: replaced_text !== text,
  }
}

function normalize_sort_direction(direction: 'ascending' | 'descending'): number {
  return direction === 'ascending' ? 1 : -1
}

function compare_text(left: string, right: string): number {
  return left.localeCompare(right, 'zh-Hans-CN')
}

const PROOFREADING_NATURAL_SORT_STATE: AppTableSortState = {
  column_id: 'file',
  direction: 'ascending',
}

function compare_visible_items(
  left_item: ProofreadingVisibleItem,
  right_item: ProofreadingVisibleItem,
  sort_state: AppTableSortState,
): number {
  const direction = normalize_sort_direction(sort_state.direction)

  if (sort_state.column_id === 'file') {
    const file_path_result = compare_text(left_item.item.file_path, right_item.item.file_path)
    if (file_path_result !== 0) {
      return file_path_result * direction
    }

    return (left_item.item.row_number - right_item.item.row_number) * direction
  }

  if (sort_state.column_id === 'status') {
    const status_rank_result = resolve_proofreading_status_sort_rank(left_item.item.status)
      - resolve_proofreading_status_sort_rank(right_item.item.status)
    if (status_rank_result !== 0) {
      return status_rank_result * direction
    }

    return compare_text(left_item.item.status, right_item.item.status) * direction
  }

  if (sort_state.column_id === 'src') {
    return compare_text(left_item.item.src, right_item.item.src) * direction
  }

  if (sort_state.column_id === 'dst') {
    return compare_text(left_item.item.dst, right_item.item.dst) * direction
  }

  return 0
}

function sort_visible_items(
  items: ProofreadingVisibleItem[],
  sort_state: AppTableSortState | null,
): ProofreadingVisibleItem[] {
  const effective_sort_state = sort_state ?? PROOFREADING_NATURAL_SORT_STATE

  return [...items].sort((left_item, right_item) => {
    const result = compare_visible_items(left_item, right_item, effective_sort_state)
    if (result !== 0) {
      return result
    }

    // 为什么：校对页需要先回到文件内自然阅读顺序，否则已有译文可能被数据库插入顺序压到列表尾部。
    if (effective_sort_state.column_id !== PROOFREADING_NATURAL_SORT_STATE.column_id) {
      const natural_order_result = compare_visible_items(
        left_item,
        right_item,
        PROOFREADING_NATURAL_SORT_STATE,
      )
      if (natural_order_result !== 0) {
        return natural_order_result
      }
    }

    return compare_text(left_item.row_id, right_item.row_id)
  })
}

function build_filter_signature(filters: ProofreadingFilterOptions | null): string {
  if (filters === null) {
    return 'null'
  }

  return JSON.stringify({
    warning_types: [...filters.warning_types].sort(),
    statuses: [...filters.statuses].sort(),
    file_paths: [...filters.file_paths].sort(),
    glossary_terms: serialize_glossary_terms(filters.glossary_terms).sort((left_term, right_term) => {
      return compare_text(left_term.join('→'), right_term.join('→'))
    }),
  })
}

function build_sort_signature(sort_state: AppTableSortState | null): string {
  return sort_state === null
    ? 'null'
    : `${sort_state.column_id}:${sort_state.direction}`
}

function are_filter_options_equal(
  left_filters: ProofreadingFilterOptions,
  right_filters: ProofreadingFilterOptions,
): boolean {
  return build_filter_signature(left_filters) === build_filter_signature(right_filters)
}

function filter_local_visible_items(args: {
  items: ProofreadingItem[]
  keyword: string
  is_regex: boolean
  scope: ProofreadingSearchScope
}): { items: ProofreadingItem[]; invalid_regex_message: string | null } {
  const trimmed_keyword = args.keyword.trim()
  if (trimmed_keyword === '') {
    return {
      items: args.items,
      invalid_regex_message: null,
    }
  }

  let search_pattern: RegExp | null = null
  try {
    search_pattern = create_search_pattern(trimmed_keyword, args.is_regex)
  } catch (error) {
    return {
      items: args.items,
      invalid_regex_message: error instanceof Error ? error.message : null,
    }
  }

  const next_items = args.items.filter((item) => {
    return matches_proofreading_search_scope({
      item,
      search_pattern,
      keyword: trimmed_keyword,
      is_regex: args.is_regex,
      scope: args.scope,
    })
  })

  return {
    items: next_items,
    invalid_regex_message: null,
  }
}

function create_task_confirm_state(
  kind: ProofreadingTranslationTaskActionKind,
): ProofreadingTaskConfirmState {
  return {
    kind,
    open: true,
    submitting: false,
    awaiting_refresh: false,
  }
}

function append_waveform_sample(history: number[], sample: number): number[] {
  const next_history = [...history, Number.isFinite(sample) ? sample : 0]
  if (next_history.length > TRANSLATION_WAVEFORM_MAX_POINTS) {
    return next_history.slice(next_history.length - TRANSLATION_WAVEFORM_MAX_POINTS)
  }

  return next_history
}

export function useProofreadingPageState(): UseProofreadingPageStateResult {
  const { t } = useI18n()
  const { push_toast } = useDesktopToast()
  const {
    proofreading_lookup_intent,
    clear_proofreading_lookup_intent,
  } = useAppNavigation()
  const {
    project_snapshot,
    set_task_snapshot,
    task_snapshot,
    proofreading_invalidation_tick,
  } = useDesktopRuntime()
  const [full_snapshot, set_full_snapshot] = useState<ProofreadingSnapshot>(() => {
    return create_empty_proofreading_snapshot()
  })
  const [server_snapshot, set_server_snapshot] = useState<ProofreadingSnapshot>(() => {
    return create_empty_proofreading_snapshot()
  })
  const [applied_filters, set_applied_filters] = useState<ProofreadingFilterOptions | null>(null)
  const [refresh_error, set_refresh_error] = useState<string | null>(null)
  const [is_refreshing, set_is_refreshing] = useState(false)
  const [is_mutating, set_is_mutating] = useState(false)
  const [search_keyword, set_search_keyword] = useState('')
  const [replace_text, set_replace_text] = useState('')
  const [search_scope, set_search_scope] = useState<ProofreadingSearchScope>('all')
  const [is_regex, set_is_regex] = useState(false)
  const [sort_state, set_sort_state] = useState<AppTableSortState | null>(null)
  const [selected_row_ids, set_selected_row_ids] = useState<string[]>([])
  const [active_row_id, set_active_row_id] = useState<string | null>(null)
  const [anchor_row_id, set_anchor_row_id] = useState<string | null>(null)
  const [filter_dialog_open, set_filter_dialog_open] = useState(false)
  const [dialog_state, set_dialog_state] = useState<ProofreadingDialogState>(() => {
    return create_empty_dialog_state()
  })
  const [pending_mutation, set_pending_mutation] = useState<ProofreadingPendingMutation | null>(null)
  const [translation_task_snapshot, set_translation_task_snapshot] = useState<ProofreadingTranslationTaskSnapshot>(() => {
    return create_empty_translation_task_snapshot()
  })
  const [last_translation_task_snapshot, set_last_translation_task_snapshot] = useState<ProofreadingTranslationTaskSnapshot | null>(null)
  const [translation_waveform_history, set_translation_waveform_history] = useState<number[]>([])
  const [translation_detail_sheet_open, set_translation_detail_sheet_open] = useState(false)
  const [task_confirm_state, set_task_confirm_state] = useState<ProofreadingTaskConfirmState | null>(null)
  const [translation_live_now_seconds, set_translation_live_now_seconds] = useState(() => {
    return Date.now() / 1000
  })
  const refresh_request_id_ref = useRef(0)
  const applied_filters_ref = useRef<ProofreadingFilterOptions | null>(applied_filters)
  const preferred_row_id_ref = useRef<string | null>(null)
  const should_select_first_visible_ref = useRef(false)
  const replace_cursor_ref = useRef(0)
  const pending_replace_cursor_ref = useRef<number | null>(null)
  const selected_row_ids_ref = useRef<string[]>(selected_row_ids)
  const active_row_id_ref = useRef<string | null>(active_row_id)
  const anchor_row_id_ref = useRef<string | null>(anchor_row_id)
  const previous_project_loaded_ref = useRef(false)
  const previous_project_path_ref = useRef('')
  const previous_task_busy_ref = useRef(task_snapshot.busy)
  const previous_invalidation_tick_ref = useRef(proofreading_invalidation_tick)
  const previous_translation_snapshot_signature_ref = useRef('')

  useEffect(() => {
    applied_filters_ref.current = applied_filters
  }, [applied_filters])

  useEffect(() => {
    selected_row_ids_ref.current = selected_row_ids
  }, [selected_row_ids])

  useEffect(() => {
    active_row_id_ref.current = active_row_id
  }, [active_row_id])

  useEffect(() => {
    anchor_row_id_ref.current = anchor_row_id
  }, [anchor_row_id])

  const clear_transient_state_for_new_project = useCallback((): void => {
    // 为什么：工程切换后旧筛选、旧搜索和旧选区都不再可信，直接清空才能避免跨工程串味。
    set_applied_filters(null)
    set_refresh_error(null)
    set_search_keyword('')
    set_replace_text('')
    set_search_scope('all')
    set_is_regex(false)
    set_sort_state(null)
    set_selected_row_ids([])
    set_active_row_id(null)
    set_anchor_row_id(null)
    set_filter_dialog_open(false)
    set_dialog_state(create_empty_dialog_state())
    set_pending_mutation(null)
    set_translation_task_snapshot(create_empty_translation_task_snapshot())
    set_last_translation_task_snapshot(null)
    set_translation_waveform_history([])
    set_translation_detail_sheet_open(false)
    set_task_confirm_state(null)
    replace_cursor_ref.current = 0
    pending_replace_cursor_ref.current = null
    preferred_row_id_ref.current = null
    should_select_first_visible_ref.current = false
    previous_translation_snapshot_signature_ref.current = ''
  }, [])

  const clear_snapshot_state = useCallback((): void => {
    set_full_snapshot(create_empty_proofreading_snapshot())
    set_server_snapshot(create_empty_proofreading_snapshot())
    set_is_refreshing(false)
    set_is_mutating(false)
  }, [])

  const visible_source_result = useMemo(() => {
    return filter_local_visible_items({
      items: server_snapshot.items,
      keyword: search_keyword,
      is_regex,
      scope: search_scope,
    })
  }, [is_regex, search_keyword, search_scope, server_snapshot.items])

  const invalid_regex_message = visible_source_result.invalid_regex_message === null
    ? null
    : `${t('proofreading_page.feedback.regex_invalid')}: ${visible_source_result.invalid_regex_message}`

  const visible_items = useMemo<ProofreadingVisibleItem[]>(() => {
    const base_visible_items = visible_source_result.items.map((item) => {
      return {
        row_id: build_proofreading_row_id(item.item_id),
        item,
        compressed_src: compress_proofreading_text(item.src),
        compressed_dst: compress_proofreading_text(item.dst),
      }
    })

    return sort_visible_items(base_visible_items, sort_state)
  }, [sort_state, visible_source_result.items])

  const visible_row_ids = useMemo(() => {
    return visible_items.map((item) => item.row_id)
  }, [visible_items])

  const visible_row_signature = useMemo(() => {
    return visible_row_ids.join('|')
  }, [visible_row_ids])

  const applied_filter_signature = useMemo(() => {
    return build_filter_signature(applied_filters)
  }, [applied_filters])

  const sort_signature = useMemo(() => {
    return build_sort_signature(sort_state)
  }, [sort_state])

  const visible_item_by_id = useMemo(() => {
    return new Map(visible_items.map((item) => {
      return [item.row_id, item.item] as const
    }))
  }, [visible_items])

  const dialog_item = dialog_state.target_row_id === null
    ? null
    : visible_item_by_id.get(dialog_state.target_row_id) ?? null

  const translation_task_display_snapshot = useMemo(() => {
    return resolve_translation_task_display_snapshot({
      current_snapshot: translation_task_snapshot,
      last_snapshot: last_translation_task_snapshot,
    })
  }, [last_translation_task_snapshot, translation_task_snapshot])

  const translation_task_metrics = useMemo(() => {
    return resolve_translation_task_metrics({
      snapshot: translation_task_display_snapshot,
      now_seconds: translation_live_now_seconds,
    })
  }, [translation_live_now_seconds, translation_task_display_snapshot])

  const translation_task_menu_busy = task_confirm_state !== null
    && (task_confirm_state.submitting || task_confirm_state.awaiting_refresh)
  const translation_task_menu_disabled = !project_snapshot.loaded
    || task_snapshot.busy
    || translation_task_menu_busy
  const can_open_translation_detail_sheet = project_snapshot.loaded

  const readonly = server_snapshot.readonly || task_snapshot.busy
  const current_filters = applied_filters ?? full_snapshot.filters

  const handle_api_error = useCallback(async (
    error: unknown,
    fallback_message: string,
  ): Promise<void> => {
    const message = resolve_error_message(error, fallback_message)
    push_toast('error', message)

    if (error instanceof DesktopApiError && error.code === 'REVISION_CONFLICT') {
      try {
        await api_fetch<ProofreadingSnapshotPayload>('/api/proofreading/snapshot', {})
      } catch {
        return
      }
    }
  }, [push_toast])

  const apply_translation_task_snapshot = useCallback((
    next_snapshot: ProofreadingTranslationTaskSnapshot,
  ): void => {
    const normalized_snapshot = clone_translation_task_snapshot(next_snapshot)
    set_translation_task_snapshot(normalized_snapshot)

    if (is_active_translation_task_status(normalized_snapshot.status)) {
      return
    }

    if (has_translation_task_progress(normalized_snapshot)) {
      set_last_translation_task_snapshot(clone_translation_task_snapshot(normalized_snapshot))
    } else {
      set_last_translation_task_snapshot(null)
      set_translation_waveform_history([])
      set_translation_detail_sheet_open(false)
    }
  }, [])

  const sync_runtime_task_snapshot = useCallback((
    next_snapshot: ProofreadingTranslationTaskSnapshot,
  ): void => {
    set_task_snapshot({
      task_type: next_snapshot.task_type,
      status: next_snapshot.status,
      busy: next_snapshot.busy,
      request_in_flight_count: next_snapshot.request_in_flight_count,
      line: next_snapshot.line,
      total_line: next_snapshot.total_line,
      processed_line: next_snapshot.processed_line,
      error_line: next_snapshot.error_line,
      total_tokens: next_snapshot.total_tokens,
      total_output_tokens: next_snapshot.total_output_tokens,
      total_input_tokens: next_snapshot.total_input_tokens,
      time: next_snapshot.time,
      start_time: next_snapshot.start_time,
      analysis_candidate_count: 0,
    })
  }, [set_task_snapshot])

  const refresh_translation_task_snapshot = useCallback(async (): Promise<void> => {
    if (!project_snapshot.loaded) {
      set_translation_task_snapshot(create_empty_translation_task_snapshot())
      set_last_translation_task_snapshot(null)
      set_translation_waveform_history([])
      set_translation_detail_sheet_open(false)
      return
    }

    try {
      const task_payload = await api_fetch<ProofreadingTranslationTaskPayload>(
        '/api/tasks/snapshot',
        { task_type: 'translation' },
      )
      apply_translation_task_snapshot(normalize_translation_task_snapshot_payload(task_payload))
    } catch (error) {
      push_toast(
        'error',
        resolve_error_message(error, t('proofreading_page.feedback.translation_task_refresh_failed')),
      )
    }
  }, [apply_translation_task_snapshot, project_snapshot.loaded, push_toast, t])

  const open_translation_detail_sheet = useCallback((): void => {
    if (can_open_translation_detail_sheet) {
      set_translation_detail_sheet_open(true)
    }
  }, [can_open_translation_detail_sheet])

  const close_translation_detail_sheet = useCallback((): void => {
    set_translation_detail_sheet_open(false)
  }, [])

  const request_start_or_continue_translation = useCallback(async (): Promise<void> => {
    if (!project_snapshot.loaded || task_snapshot.busy || translation_task_menu_busy) {
      return
    }

    const should_continue = has_translation_task_progress(translation_task_display_snapshot)

    try {
      const task_payload = await api_fetch<ProofreadingTaskCommandPayload>(
        '/api/tasks/start-translation',
        { mode: should_continue ? 'CONTINUE' : 'NEW' },
      )
      const next_snapshot = normalize_translation_task_snapshot_payload(task_payload)
      apply_translation_task_snapshot(next_snapshot)
      sync_runtime_task_snapshot(next_snapshot)

      if (!should_continue) {
        set_last_translation_task_snapshot(null)
        set_translation_waveform_history([])
      }
    } catch (error) {
      push_toast(
        'error',
        resolve_error_message(error, t('proofreading_page.feedback.translation_task_start_failed')),
      )
    }
  }, [
    apply_translation_task_snapshot,
    project_snapshot.loaded,
    push_toast,
    sync_runtime_task_snapshot,
    t,
    task_snapshot.busy,
    translation_task_display_snapshot,
    translation_task_menu_busy,
  ])

  const request_task_action_confirmation = useCallback((
    kind: ProofreadingTranslationTaskActionKind,
  ): void => {
    set_task_confirm_state(create_task_confirm_state(kind))
  }, [])

  const close_task_action_confirmation = useCallback((): void => {
    set_task_confirm_state((previous_state) => {
      if (previous_state === null) {
        return null
      }

      if (previous_state.submitting || previous_state.awaiting_refresh) {
        return {
          ...previous_state,
          open: false,
        }
      }

      return null
    })
  }, [])

  const confirm_task_action = useCallback(async (): Promise<void> => {
    if (task_confirm_state === null) {
      return
    }

    set_task_confirm_state((previous_state) => {
      if (previous_state === null) {
        return null
      }

      return {
        ...previous_state,
        submitting: true,
      }
    })

    try {
      if (task_confirm_state.kind === 'stop-translation') {
        const task_payload = await api_fetch<ProofreadingTaskCommandPayload>(
          '/api/tasks/stop-translation',
          {},
        )
        const next_snapshot = normalize_translation_task_snapshot_payload(task_payload)
        apply_translation_task_snapshot(next_snapshot)
        sync_runtime_task_snapshot(next_snapshot)
        set_task_confirm_state(null)
      } else {
        const reset_path = task_confirm_state.kind === 'reset-all'
          ? '/api/tasks/reset-translation-all'
          : '/api/tasks/reset-translation-failed'
        await api_fetch<ProofreadingTaskCommandPayload>(reset_path, {})
        set_task_confirm_state((previous_state) => {
          if (previous_state === null) {
            return null
          }

          return {
            ...previous_state,
            open: false,
            submitting: false,
            awaiting_refresh: true,
          }
        })
      }
    } catch (error) {
      let fallback_message = t('proofreading_page.feedback.translation_task_stop_failed')

      if (task_confirm_state.kind === 'reset-all') {
        fallback_message = t('proofreading_page.feedback.translation_task_reset_all_failed')
      } else if (task_confirm_state.kind === 'reset-failed') {
        fallback_message = t('proofreading_page.feedback.translation_task_reset_failed_failed')
      }

      push_toast('error', resolve_error_message(error, fallback_message))
      set_task_confirm_state(null)
    }
  }, [
    apply_translation_task_snapshot,
    push_toast,
    sync_runtime_task_snapshot,
    t,
    task_confirm_state,
  ])

  const refresh_snapshot = useCallback(async (
    options?: {
      preferred_row_id?: string | null
      reset_filters?: boolean
    },
  ): Promise<void> => {
    if (!project_snapshot.loaded) {
      clear_transient_state_for_new_project()
      clear_snapshot_state()
      return
    }

    const request_id = refresh_request_id_ref.current + 1
    refresh_request_id_ref.current = request_id
    set_is_refreshing(true)

    try {
      const snapshot_payload = await api_fetch<ProofreadingSnapshotPayload>(
        '/api/proofreading/snapshot',
        {},
      )
      const next_full_snapshot = normalize_proofreading_snapshot_payload(snapshot_payload)
      const next_applied_filters = options?.reset_filters === true
        ? clone_proofreading_filter_options(next_full_snapshot.filters)
        : clone_proofreading_filter_options(
            applied_filters_ref.current ?? next_full_snapshot.filters,
          )

      let next_server_snapshot = next_full_snapshot

      // 为什么：页面要同时保留“筛选弹窗的全量底稿”和“当前筛后的工作范围”，所以这里拆成双快照管理。
      if (!are_filter_options_equal(next_applied_filters, next_full_snapshot.filters)) {
        const filtered_payload = await api_fetch<ProofreadingSnapshotPayload>(
          '/api/proofreading/filter',
          {
            filter_options: serialize_filter_options(next_applied_filters),
          },
        )
        next_server_snapshot = normalize_proofreading_snapshot_payload(filtered_payload)
      }

      if (request_id !== refresh_request_id_ref.current) {
        return
      }

      preferred_row_id_ref.current = options?.preferred_row_id ?? active_row_id_ref.current
      set_full_snapshot(next_full_snapshot)
      set_server_snapshot(next_server_snapshot)
      set_applied_filters(next_applied_filters)
      set_refresh_error(null)
    } catch (error) {
      if (request_id !== refresh_request_id_ref.current) {
        return
      }

      const message = resolve_error_message(error, t('proofreading_page.feedback.refresh_failed'))
      set_refresh_error(message)
      push_toast('error', message)
    } finally {
      if (request_id === refresh_request_id_ref.current) {
        set_is_refreshing(false)
      }
    }
  }, [
    project_snapshot.loaded,
    clear_snapshot_state,
    clear_transient_state_for_new_project,
    push_toast,
    t,
  ])

  const apply_filter_options = useCallback(async (
    next_filters: ProofreadingFilterOptions,
  ): Promise<void> => {
    if (!project_snapshot.loaded) {
      return
    }

    set_filter_dialog_open(false)
    set_is_refreshing(true)

    try {
      const normalized_filters = clone_proofreading_filter_options(next_filters)
      const next_server_snapshot = are_filter_options_equal(normalized_filters, full_snapshot.filters)
        ? full_snapshot
        : normalize_proofreading_snapshot_payload(
            await api_fetch<ProofreadingSnapshotPayload>(
              '/api/proofreading/filter',
              {
                filter_options: serialize_filter_options(normalized_filters),
              },
            ),
          )

      preferred_row_id_ref.current = null
      should_select_first_visible_ref.current = true
      set_server_snapshot(next_server_snapshot)
      set_applied_filters(clone_proofreading_filter_options(normalized_filters))
      set_refresh_error(null)
    } catch (error) {
      await handle_api_error(error, t('proofreading_page.feedback.filter_failed'))
    } finally {
      set_is_refreshing(false)
    }
  }, [full_snapshot, handle_api_error, project_snapshot.loaded, t])

  const run_mutation = useCallback(async (args: {
    path: string
    body: Record<string, unknown>
    fallback_error_key:
      | 'proofreading_page.feedback.save_failed'
      | 'proofreading_page.feedback.replace_failed'
      | 'proofreading_page.feedback.retranslate_failed'
      | 'proofreading_page.feedback.reset_failed'
    preferred_row_id?: string | null
    pending_replace_cursor?: number | null
    success_message_builder?: ((changed_count: number) => string) | null
    empty_warning_message?: string | null
    close_dialog?: boolean
  }): Promise<void> => {
    set_is_mutating(true)

    try {
      const mutation_payload = await api_fetch<ProofreadingMutationPayload>(
        args.path,
        args.body,
      )
      const mutation_result = normalize_proofreading_mutation_payload(mutation_payload)

      if (mutation_result.changed_item_ids.length === 0) {
        if (args.empty_warning_message !== null && args.empty_warning_message !== undefined) {
          push_toast('warning', args.empty_warning_message)
        }
        return
      }

      if (args.pending_replace_cursor !== undefined) {
        pending_replace_cursor_ref.current = args.pending_replace_cursor
      }

      if (args.success_message_builder !== null && args.success_message_builder !== undefined) {
        push_toast('success', args.success_message_builder(mutation_result.changed_item_ids.length))
      }

      if (args.close_dialog) {
        set_dialog_state(create_empty_dialog_state())
      }

      await refresh_snapshot({
        preferred_row_id: args.preferred_row_id ?? active_row_id_ref.current,
      })
    } catch (error) {
      await handle_api_error(error, t(args.fallback_error_key))
    } finally {
      set_is_mutating(false)
    }
  }, [handle_api_error, push_toast, refresh_snapshot, t])

  const update_search_keyword = useCallback((next_keyword: string): void => {
    set_search_keyword(next_keyword)
    should_select_first_visible_ref.current = false
  }, [])

  const update_replace_text = useCallback((next_replace_text: string): void => {
    set_replace_text(next_replace_text)
  }, [])

  const update_search_scope = useCallback((next_scope: ProofreadingSearchScope): void => {
    set_search_scope(next_scope)
    should_select_first_visible_ref.current = false
  }, [])

  const update_regex = useCallback((next_is_regex: boolean): void => {
    set_is_regex(next_is_regex)
    should_select_first_visible_ref.current = false
  }, [])

  const apply_table_selection = useCallback((payload: AppTableSelectionChange): void => {
    set_selected_row_ids(payload.selected_row_ids)
    set_active_row_id(payload.active_row_id)
    set_anchor_row_id(payload.anchor_row_id)
  }, [])

  const apply_table_sort_state = useCallback((next_sort_state: AppTableSortState | null): void => {
    set_sort_state(next_sort_state)
  }, [])

  const open_filter_dialog = useCallback((): void => {
    set_filter_dialog_open(true)
  }, [])

  const close_filter_dialog = useCallback((): void => {
    set_filter_dialog_open(false)
  }, [])

  const open_edit_dialog = useCallback((row_id: string): void => {
    const target_item = visible_item_by_id.get(row_id)
    if (target_item === undefined) {
      return
    }

    set_dialog_state({
      open: true,
      target_row_id: row_id,
      draft_dst: target_item.dst,
      saving: false,
    })
  }, [visible_item_by_id])

  const request_close_dialog = useCallback((): void => {
    set_dialog_state(create_empty_dialog_state())
  }, [])

  const update_dialog_draft = useCallback((next_draft_dst: string): void => {
    set_dialog_state((previous_state) => {
      return {
        ...previous_state,
        draft_dst: next_draft_dst,
      }
    })
  }, [])

  const save_dialog_entry = useCallback(async (): Promise<void> => {
    if (dialog_state.target_row_id === null) {
      return
    }

    const target_item = visible_item_by_id.get(dialog_state.target_row_id)
    if (target_item === undefined) {
      set_dialog_state(create_empty_dialog_state())
      return
    }

    if (dialog_state.draft_dst === target_item.dst) {
      set_dialog_state(create_empty_dialog_state())
      push_toast('success', t('app.feedback.save_success'))
      return
    }

    set_dialog_state((previous_state) => {
      return {
        ...previous_state,
        saving: true,
      }
    })

    try {
      await run_mutation({
        path: '/api/proofreading/save-item',
        body: {
          item: serialize_item(target_item),
          new_dst: dialog_state.draft_dst,
          expected_revision: server_snapshot.revision,
        },
        fallback_error_key: 'proofreading_page.feedback.save_failed',
        preferred_row_id: dialog_state.target_row_id,
        success_message_builder: () => t('app.feedback.save_success'),
        close_dialog: true,
      })
    } finally {
      set_dialog_state((previous_state) => {
        if (previous_state.target_row_id !== dialog_state.target_row_id) {
          return previous_state
        }

        return {
          ...previous_state,
          saving: false,
        }
      })
    }
  }, [dialog_state, push_toast, run_mutation, server_snapshot.revision, t, visible_item_by_id])

  const replace_next_visible_match = useCallback(async (): Promise<void> => {
    if (readonly || is_refreshing || is_mutating) {
      return
    }

    const trimmed_keyword = search_keyword.trim()
    if (trimmed_keyword === '') {
      push_toast('warning', t('proofreading_page.feedback.no_match'))
      return
    }

    let search_pattern: RegExp
    try {
      search_pattern = create_search_pattern(trimmed_keyword, is_regex) ?? /^$/u
    } catch (error) {
      push_toast(
        'error',
        `${t('proofreading_page.feedback.regex_invalid')}: ${resolve_error_message(error, '')}`,
      )
      return
    }

    let target_index = -1
    let target_item: ProofreadingItem | null = null
    for (let index = replace_cursor_ref.current; index < visible_items.length; index += 1) {
      const candidate_item = visible_items[index]?.item
      if (candidate_item === undefined) {
        continue
      }

      if (!matches_search_pattern(candidate_item.dst, search_pattern, trimmed_keyword, is_regex)) {
        continue
      }

      target_index = index
      target_item = candidate_item
      break
    }

    if (target_item === null || target_index < 0) {
      push_toast('warning', t('proofreading_page.feedback.replace_no_change'))
      return
    }

    const replaced_result = replace_first_visible_match(
      target_item.dst,
      search_pattern,
      replace_text,
    )
    if (!replaced_result.replaced) {
      push_toast('warning', t('proofreading_page.feedback.replace_no_change'))
      return
    }

    await run_mutation({
      path: '/api/proofreading/save-item',
      body: {
        item: serialize_item(target_item),
        new_dst: replaced_result.text,
        expected_revision: server_snapshot.revision,
      },
      fallback_error_key: 'proofreading_page.feedback.replace_failed',
      preferred_row_id: build_proofreading_row_id(target_item.item_id),
      pending_replace_cursor: target_index + 1,
    })
  }, [
    is_mutating,
    is_refreshing,
    is_regex,
    push_toast,
    readonly,
    replace_text,
    run_mutation,
    search_keyword,
    server_snapshot.revision,
    t,
    visible_items,
  ])

  const replace_all_visible_matches = useCallback(async (): Promise<void> => {
    if (readonly || is_refreshing || is_mutating) {
      return
    }

    const trimmed_keyword = search_keyword.trim()
    if (trimmed_keyword === '') {
      push_toast('warning', t('proofreading_page.feedback.replace_no_change'))
      return
    }

    let search_pattern: RegExp
    try {
      search_pattern = create_search_pattern(trimmed_keyword, is_regex) ?? /^$/u
    } catch (error) {
      push_toast(
        'error',
        `${t('proofreading_page.feedback.regex_invalid')}: ${resolve_error_message(error, '')}`,
      )
      return
    }

    const target_items = visible_items
      .map((item) => item.item)
      .filter((item) => {
        return matches_search_pattern(item.dst, search_pattern, trimmed_keyword, is_regex)
      })

    if (target_items.length === 0) {
      push_toast('warning', t('proofreading_page.feedback.replace_no_change'))
      return
    }

    await run_mutation({
      path: '/api/proofreading/replace-all',
      body: {
        items: target_items.map((item) => serialize_item(item)),
        search_text: trimmed_keyword,
        replace_text: replace_text,
        is_regex,
        expected_revision: server_snapshot.revision,
      },
      fallback_error_key: 'proofreading_page.feedback.replace_failed',
      preferred_row_id: active_row_id_ref.current,
      pending_replace_cursor: 0,
      success_message_builder: (changed_count) => {
        return t('proofreading_page.feedback.replace_done').replace(
          '{N}',
          changed_count.toString(),
        )
      },
      empty_warning_message: t('proofreading_page.feedback.replace_no_change'),
      close_dialog: true,
    })
  }, [
    is_mutating,
    is_refreshing,
    is_regex,
    push_toast,
    readonly,
    replace_text,
    run_mutation,
    search_keyword,
    server_snapshot.revision,
    t,
    visible_items,
  ])

  const request_retranslate_row_ids = useCallback((row_ids: string[]): void => {
    if (row_ids.length === 0) {
      return
    }

    set_pending_mutation({
      kind: 'retranslate-items',
      target_row_ids: row_ids,
    })
  }, [])

  const request_reset_row_ids = useCallback((row_ids: string[]): void => {
    if (row_ids.length === 0) {
      return
    }

    set_pending_mutation({
      kind: 'reset-items',
      target_row_ids: row_ids,
    })
  }, [])

  const close_pending_mutation = useCallback((): void => {
    set_pending_mutation(null)
  }, [])

  const confirm_pending_mutation = useCallback(async (): Promise<void> => {
    if (pending_mutation === null) {
      return
    }

    const target_items = pending_mutation.target_row_ids
      .map((row_id) => visible_item_by_id.get(row_id) ?? null)
      .filter((item): item is ProofreadingItem => item !== null)
    if (target_items.length === 0) {
      set_pending_mutation(null)
      return
    }

    const is_retranslate = pending_mutation.kind === 'retranslate-items'
    const fallback_error_key = is_retranslate
      ? 'proofreading_page.feedback.retranslate_failed'
      : 'proofreading_page.feedback.reset_failed'
    const success_message = is_retranslate
      ? t('proofreading_page.feedback.retranslate_success')
          .replace('{COUNT}', '{COUNT}')
      : t('proofreading_page.feedback.reset_success')
          .replace('{COUNT}', '{COUNT}')

    set_pending_mutation(null)
    await run_mutation({
      path: is_retranslate
        ? '/api/proofreading/retranslate-items'
        : '/api/proofreading/save-all',
      body: is_retranslate
        ? {
            items: target_items.map((item) => serialize_item(item)),
            expected_revision: server_snapshot.revision,
          }
        : {
            items: target_items.map((item) => {
              return serialize_item({
                ...item,
                dst: '',
                status: 'NONE',
              })
            }),
            expected_revision: server_snapshot.revision,
          },
      fallback_error_key,
      preferred_row_id: active_row_id_ref.current,
      success_message_builder: (changed_count) => {
        return success_message.replace('{COUNT}', changed_count.toString())
      },
      close_dialog: dialog_state.open,
    })
  }, [dialog_state.open, pending_mutation, run_mutation, server_snapshot.revision, t, visible_item_by_id])

  useEffect(() => {
    const previous_project_loaded = previous_project_loaded_ref.current
    const previous_project_path = previous_project_path_ref.current

    previous_project_loaded_ref.current = project_snapshot.loaded
    previous_project_path_ref.current = project_snapshot.path

    if (!project_snapshot.loaded) {
      clear_transient_state_for_new_project()
      clear_snapshot_state()
      return
    }

    if (!previous_project_loaded || previous_project_path !== project_snapshot.path) {
      clear_transient_state_for_new_project()
      void Promise.all([
        refresh_snapshot({
          preferred_row_id: null,
          reset_filters: true,
        }),
        refresh_translation_task_snapshot(),
      ])
    }
  }, [
    project_snapshot.loaded,
    project_snapshot.path,
    clear_snapshot_state,
    clear_transient_state_for_new_project,
    refresh_snapshot,
    refresh_translation_task_snapshot,
  ])

  useEffect(() => {
    const previous_task_busy = previous_task_busy_ref.current
    previous_task_busy_ref.current = task_snapshot.busy

    if (!project_snapshot.loaded) {
      return
    }

    if (previous_task_busy && !task_snapshot.busy) {
      void Promise.all([
        refresh_snapshot(),
        refresh_translation_task_snapshot(),
      ])
    }
  }, [project_snapshot.loaded, refresh_snapshot, refresh_translation_task_snapshot, task_snapshot.busy])

  useEffect(() => {
    const previous_tick = previous_invalidation_tick_ref.current
    previous_invalidation_tick_ref.current = proofreading_invalidation_tick

    if (!project_snapshot.loaded) {
      return
    }

    if (previous_tick !== proofreading_invalidation_tick) {
      void (async (): Promise<void> => {
        await Promise.all([
          refresh_snapshot(),
          refresh_translation_task_snapshot(),
        ])
        set_task_confirm_state((previous_state) => {
          if (previous_state !== null && previous_state.awaiting_refresh) {
            return null
          }

          return previous_state
        })
      })()
    }
  }, [
    project_snapshot.loaded,
    proofreading_invalidation_tick,
    refresh_snapshot,
    refresh_translation_task_snapshot,
  ])

  useEffect(() => {
    if (task_snapshot.task_type !== 'translation') {
      return
    }

    apply_translation_task_snapshot(normalize_translation_task_snapshot_payload({
      task: task_snapshot,
    }))
  }, [apply_translation_task_snapshot, task_snapshot])

  useEffect(() => {
    if (!is_active_translation_task_status(translation_task_snapshot.status)) {
      return
    }

    set_translation_live_now_seconds(Date.now() / 1000)
    const timer_id = window.setInterval(() => {
      set_translation_live_now_seconds(Date.now() / 1000)
    }, TRANSLATION_TASK_LIVE_TICK_MS)

    return () => {
      window.clearInterval(timer_id)
    }
  }, [translation_task_snapshot.status])

  useEffect(() => {
    if (!is_active_translation_task_status(translation_task_snapshot.status)) {
      previous_translation_snapshot_signature_ref.current = ''
      return
    }

    const signature = [
      translation_task_snapshot.status,
      translation_task_snapshot.line.toString(),
      translation_task_snapshot.total_line.toString(),
      translation_task_snapshot.total_output_tokens.toString(),
      translation_task_snapshot.request_in_flight_count.toString(),
      Math.floor(translation_live_now_seconds).toString(),
    ].join(':')

    if (previous_translation_snapshot_signature_ref.current === signature) {
      return
    }

    previous_translation_snapshot_signature_ref.current = signature
    const next_metrics = resolve_translation_task_metrics({
      snapshot: translation_task_snapshot,
      now_seconds: translation_live_now_seconds,
    })
    set_translation_waveform_history((previous_history) => {
      return append_waveform_sample(previous_history, next_metrics.average_output_speed)
    })
  }, [
    translation_live_now_seconds,
    translation_task_snapshot,
  ])

  useEffect(() => {
    if (!can_open_translation_detail_sheet) {
      set_translation_detail_sheet_open(false)
    }
  }, [can_open_translation_detail_sheet])

  useEffect(() => {
    if (proofreading_lookup_intent === null) {
      return
    }

    set_search_keyword(proofreading_lookup_intent.keyword)
    set_search_scope('all')
    set_is_regex(proofreading_lookup_intent.is_regex)
    should_select_first_visible_ref.current = true
    clear_proofreading_lookup_intent()
  }, [clear_proofreading_lookup_intent, proofreading_lookup_intent])

  useEffect(() => {
    if (pending_replace_cursor_ref.current !== null) {
      replace_cursor_ref.current = pending_replace_cursor_ref.current
      pending_replace_cursor_ref.current = null
      return
    }

    // 为什么：搜索条件、排序或服务端快照变化后，“下一次替换”必须重新从新的可见顺序起点开始计算。
    replace_cursor_ref.current = 0
  }, [
    applied_filter_signature,
    is_regex,
    search_keyword,
    search_scope,
    server_snapshot.revision,
    sort_signature,
    visible_row_signature,
  ])

  useEffect(() => {
    const visible_row_id_set = new Set(visible_row_ids)
    const preferred_row_id = preferred_row_id_ref.current

    if (preferred_row_id !== null) {
      preferred_row_id_ref.current = null
      if (visible_row_id_set.has(preferred_row_id)) {
        set_selected_row_ids([preferred_row_id])
        set_active_row_id(preferred_row_id)
        set_anchor_row_id(preferred_row_id)
        return
      }
    }

    if (should_select_first_visible_ref.current && visible_row_ids.length > 0) {
      should_select_first_visible_ref.current = false
      const first_visible_row_id = visible_row_ids[0] ?? null
      if (first_visible_row_id !== null) {
        set_selected_row_ids([first_visible_row_id])
        set_active_row_id(first_visible_row_id)
        set_anchor_row_id(first_visible_row_id)
        return
      }
    }

    const next_selected_row_ids = selected_row_ids_ref.current.filter((row_id) => {
      return visible_row_id_set.has(row_id)
    })
    const next_active_row_id = active_row_id_ref.current !== null
      && visible_row_id_set.has(active_row_id_ref.current)
      ? active_row_id_ref.current
      : next_selected_row_ids[0] ?? null
    const next_anchor_row_id = anchor_row_id_ref.current !== null
      && visible_row_id_set.has(anchor_row_id_ref.current)
      ? anchor_row_id_ref.current
      : next_active_row_id

    set_selected_row_ids(next_selected_row_ids)
    set_active_row_id(next_active_row_id)
    set_anchor_row_id(next_anchor_row_id)
  }, [visible_row_ids])

  return useMemo<UseProofreadingPageStateResult>(() => {
    return {
      refresh_error,
      is_refreshing,
      is_mutating,
      readonly,
      search_keyword,
      replace_text,
      search_scope,
      is_regex,
      invalid_regex_message,
      full_snapshot,
      server_snapshot,
      current_filters,
      visible_items,
      sort_state,
      selected_row_ids,
      active_row_id,
      anchor_row_id,
      filter_dialog_open,
      dialog_state,
      dialog_item,
      pending_mutation,
      translation_task_snapshot,
      last_translation_task_snapshot,
      translation_task_display_snapshot,
      translation_task_metrics,
      translation_waveform_history,
      translation_detail_sheet_open,
      task_confirm_state,
      translation_task_menu_disabled,
      translation_task_menu_busy,
      can_open_translation_detail_sheet,
      refresh_snapshot: async () => {
        await refresh_snapshot()
      },
      update_search_keyword,
      update_replace_text,
      update_search_scope,
      update_regex,
      apply_table_selection,
      apply_table_sort_state,
      open_filter_dialog,
      close_filter_dialog,
      apply_filter_options,
      open_edit_dialog,
      request_close_dialog,
      update_dialog_draft,
      save_dialog_entry,
      replace_next_visible_match,
      replace_all_visible_matches,
      request_retranslate_row_ids,
      request_reset_row_ids,
      confirm_pending_mutation,
      close_pending_mutation,
      open_translation_detail_sheet,
      close_translation_detail_sheet,
      request_start_or_continue_translation,
      request_task_action_confirmation,
      confirm_task_action,
      close_task_action_confirmation,
    }
  }, [
    refresh_error,
    is_refreshing,
    is_mutating,
    readonly,
    search_keyword,
    replace_text,
    search_scope,
    is_regex,
    invalid_regex_message,
    full_snapshot,
    server_snapshot,
    current_filters,
    visible_items,
    sort_state,
    selected_row_ids,
    active_row_id,
    anchor_row_id,
    filter_dialog_open,
    dialog_state,
    dialog_item,
    pending_mutation,
    translation_task_snapshot,
    last_translation_task_snapshot,
    translation_task_display_snapshot,
    translation_task_metrics,
    translation_waveform_history,
    translation_detail_sheet_open,
    task_confirm_state,
    translation_task_menu_disabled,
    translation_task_menu_busy,
    can_open_translation_detail_sheet,
    refresh_snapshot,
    update_search_keyword,
    update_replace_text,
    update_search_scope,
    update_regex,
    apply_table_selection,
    apply_table_sort_state,
    open_filter_dialog,
    close_filter_dialog,
    apply_filter_options,
    open_edit_dialog,
    request_close_dialog,
    update_dialog_draft,
    save_dialog_entry,
    replace_next_visible_match,
    replace_all_visible_matches,
    request_retranslate_row_ids,
    request_reset_row_ids,
    confirm_pending_mutation,
    close_pending_mutation,
    open_translation_detail_sheet,
    close_translation_detail_sheet,
    request_start_or_continue_translation,
    request_task_action_confirmation,
    confirm_task_action,
    close_task_action_confirmation,
  ])
}
