import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import { api_fetch } from '@/app/desktop-api'
import { createProjectStoreReplaceSectionPatch } from '@/app/project-runtime/project-store'
import {
  collect_project_item_texts,
  run_quality_statistics_task,
} from '@/app/project-runtime/quality-statistics'
import { useProjectPagesBarrier } from '@/app/state/project-pages-context'
import { useAppNavigation } from '@/app/navigation/navigation-context'
import {
  buildProofreadingLookupQuery,
  getQualityRuleSlice,
  replaceQualityRuleSlice,
} from '@/app/project-runtime/quality-runtime'
import {
  normalize_settings_snapshot,
  type SettingsSnapshotPayload,
} from '@/app/state/desktop-runtime-context'
import { useDesktopRuntime } from '@/app/state/use-desktop-runtime'
import { useDesktopToast } from '@/app/state/use-desktop-toast'
import { useI18n, type LocaleKey } from '@/i18n'
import {
  build_text_preserve_filter_result,
  has_active_text_preserve_filters,
  resolve_text_preserve_statistics_badge_kind,
  sort_text_preserve_entries,
} from '@/pages/text-preserve-page/filtering'
import { merge_text_preserve_entries } from '@/pages/text-preserve-page/merge'
import {
  are_text_preserve_entry_ids_equal,
  build_text_preserve_entry_id,
  reorder_text_preserve_selected_group,
} from '@/pages/text-preserve-page/selection'
import type {
  TextPreserveConfirmState,
  TextPreserveDialogState,
  TextPreserveEntry,
  TextPreserveEntryId,
  TextPreserveFilterScope,
  TextPreserveFilterState,
  TextPreserveMode,
  TextPreservePresetInputState,
  TextPreservePresetItem,
  TextPreserveStatisticsBadgeState,
  TextPreserveStatisticsState,
  TextPreserveVisibleEntry,
  UseTextPreservePageStateResult,
} from '@/pages/text-preserve-page/types'
import type {
  AppTableSelectionChange,
  AppTableSortState,
} from '@/widgets/app-table/app-table-types'

type TextPreserveSnapshot = {
  revision: number
  meta: {
    mode?: string
  }
  entries: Array<Partial<TextPreserveEntry>>
}

type TextPreserveMutationAckPayload = {
  accepted?: boolean
}

type TextPreservePresetPayload = {
  builtin_presets: TextPreservePresetItem[]
  user_presets: TextPreservePresetItem[]
}

const TEXT_PRESERVE_RULE_TYPE = 'text_preserve'
const TEXT_PRESERVE_PRESET_DIR_NAME = 'text_preserve'
const TEXT_PRESERVE_DEFAULT_PRESET_SETTINGS_KEY = 'text_preserve_default_preset'
const TEXT_PRESERVE_TITLE_KEY: LocaleKey = 'text_preserve_page.title'
const TEXT_PRESERVE_EXPORT_FILE_NAME = 'text_preserve.json'
const DEFAULT_MODE: TextPreserveMode = 'off'
const TEXT_PRESERVE_MODE_REFRESH_TIMEOUT_MS = 15000
const MODAL_PROGRESS_TIMEOUT_MESSAGE = '模态进度通知等待超时。'

const EMPTY_ENTRY: TextPreserveEntry = {
  src: '',
  info: '',
}

function clone_entry(entry: TextPreserveEntry): TextPreserveEntry {
  return {
    entry_id: entry.entry_id,
    src: entry.src,
    info: entry.info,
  }
}

function normalize_entry(entry: Partial<TextPreserveEntry>): TextPreserveEntry {
  return {
    entry_id: entry.entry_id,
    src: String(entry.src ?? '').trim(),
    info: String(entry.info ?? '').trim(),
  }
}

function normalize_imported_entry(entry: Record<string, unknown>): TextPreserveEntry {
  return normalize_entry({
    src: String(entry.src ?? ''),
    info: String(entry.info ?? ''),
  })
}

function normalize_mode(candidate: string | undefined): TextPreserveMode {
  if (candidate === 'smart' || candidate === 'custom') {
    return candidate
  }

  return DEFAULT_MODE
}

function create_empty_filter_state(): TextPreserveFilterState {
  return {
    keyword: '',
    scope: 'all',
    is_regex: false,
  }
}

function create_empty_statistics_state(): TextPreserveStatisticsState {
  return {
    running: false,
    completed_revision: null,
    completed_entry_ids: [],
    matched_count_by_entry_id: {},
    subset_parent_labels_by_entry_id: {},
  }
}

function create_empty_dialog_state(): TextPreserveDialogState {
  return {
    open: false,
    mode: 'create',
    target_entry_id: null,
    insert_after_entry_id: null,
    draft_entry: clone_entry(EMPTY_ENTRY),
    dirty: false,
    saving: false,
    validation_message: null,
  }
}

function create_empty_confirm_state(): TextPreserveConfirmState {
  return {
    open: false,
    kind: null,
    selection_count: 0,
    preset_name: '',
    preset_input_value: '',
    submitting: false,
    target_virtual_id: null,
  }
}

function create_empty_preset_input_state(): TextPreservePresetInputState {
  return {
    open: false,
    mode: null,
    value: '',
    submitting: false,
    target_virtual_id: null,
  }
}

function build_user_preset_virtual_id(name: string): string {
  return `user:${name}.json`
}

function normalize_preset_name(name: string): string {
  return name.trim()
}

function has_casefold_duplicate_preset(
  preset_items: TextPreservePresetItem[],
  target_virtual_id: string,
  current_virtual_id: string | null,
): boolean {
  const target_key = target_virtual_id.toLocaleLowerCase()

  return preset_items.some((item) => {
    if (item.type !== 'user') {
      return false
    }

    if (current_virtual_id !== null && item.virtual_id === current_virtual_id) {
      return false
    }

    return item.virtual_id.toLocaleLowerCase() === target_key
  })
}

function decorate_preset_items(
  builtin_presets: TextPreservePresetItem[],
  user_presets: TextPreservePresetItem[],
  default_virtual_id: string,
): TextPreservePresetItem[] {
  return [...builtin_presets, ...user_presets].map((item) => {
    return {
      ...item,
      is_default: item.virtual_id === default_virtual_id,
    }
  })
}

function build_statistics_badge_tooltip(
  t: (key: LocaleKey) => string,
  entry: TextPreserveEntry,
  matched_count: number,
  subset_parent_labels: string[],
): string {
  const tooltip_lines = [
    t('text_preserve_page.statistics.hit_count').replace(
      '{COUNT}',
      matched_count.toString(),
    ),
  ]

  if (subset_parent_labels.length > 0) {
    tooltip_lines.push(t('text_preserve_page.statistics.subset_relations'))
    tooltip_lines.push(...subset_parent_labels.map((label) => {
      return t('text_preserve_page.statistics.relation_line')
        .replace('{CHILD}', entry.src)
        .replace('{PARENT}', label)
    }))
  }

  return tooltip_lines.join('\n')
}

function build_default_preset_update_payload(value: string): Record<string, string> {
  return {
    [TEXT_PRESERVE_DEFAULT_PRESET_SETTINGS_KEY]: value,
  }
}

function resolve_text_preserve_error_message(
  error: unknown,
  fallback_message: string,
): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message
  }

  return fallback_message
}

function is_modal_progress_timeout_error(error: unknown): boolean {
  return error instanceof Error && error.message === MODAL_PROGRESS_TIMEOUT_MESSAGE
}

export function useTextPreservePageState(): UseTextPreservePageStateResult {
  const { t } = useI18n()
  const { create_barrier_checkpoint, wait_for_barrier } = useProjectPagesBarrier()
  const { push_toast, run_modal_progress_toast } = useDesktopToast()
  const { navigate_to_route, push_proofreading_lookup_intent } = useAppNavigation()
  const {
    project_snapshot,
    project_store,
    settings_snapshot,
    set_settings_snapshot,
    commit_local_project_patch,
  } = useDesktopRuntime()
  const project_store_state = useSyncExternalStore(
    project_store.subscribe,
    project_store.getState,
    project_store.getState,
  )

  const [revision, set_revision] = useState(0)
  const [mode, set_mode] = useState<TextPreserveMode>(DEFAULT_MODE)
  const [mode_updating, set_mode_updating] = useState(false)
  const [entries, set_entries] = useState<TextPreserveEntry[]>([])
  const [preset_items, set_preset_items] = useState<TextPreservePresetItem[]>([])
  const [selected_entry_ids, set_selected_entry_ids] = useState<TextPreserveEntryId[]>([])
  const [active_entry_id, set_active_entry_id] = useState<TextPreserveEntryId | null>(null)
  const [selection_anchor_entry_id, set_selection_anchor_entry_id] = useState<TextPreserveEntryId | null>(null)
  const [preset_menu_open, set_preset_menu_open] = useState(false)
  const [filter_state, set_filter_state] = useState<TextPreserveFilterState>(() => {
    return create_empty_filter_state()
  })
  const [sort_state, set_sort_state] = useState<AppTableSortState | null>(null)
  const [statistics_state, set_statistics_state] = useState<TextPreserveStatisticsState>(() => {
    return create_empty_statistics_state()
  })
  const [dialog_state, set_dialog_state] = useState<TextPreserveDialogState>(() => {
    return create_empty_dialog_state()
  })
  const [confirm_state, set_confirm_state] = useState<TextPreserveConfirmState>(() => {
    return create_empty_confirm_state()
  })
  const [preset_input_state, set_preset_input_state] = useState<TextPreservePresetInputState>(() => {
    return create_empty_preset_input_state()
  })
  const unknown_error_message = t('text_preserve_page.feedback.unknown_error')
  const revision_ref = useRef(revision)
  const mode_ref = useRef(mode)
  const mode_update_in_flight_ref = useRef(false)

  useEffect(() => {
    revision_ref.current = revision
  }, [revision])

  useEffect(() => {
    mode_ref.current = mode
  }, [mode])

  const entry_ids = useMemo<TextPreserveEntryId[]>(() => {
    return entries.map((entry, index) => {
      return build_text_preserve_entry_id(entry, index)
    })
  }, [entries])

  const entry_index_by_id = useMemo(() => {
    return new Map(entry_ids.map((entry_id, index) => [entry_id, index]))
  }, [entry_ids])

  const resolve_create_insert_after_entry_id = useCallback((): TextPreserveEntryId | null => {
    if (active_entry_id !== null && entry_index_by_id.has(active_entry_id)) {
      return active_entry_id
    }

    for (let index = selected_entry_ids.length - 1; index >= 0; index -= 1) {
      const selected_entry_id = selected_entry_ids[index]
      if (selected_entry_id !== undefined && entry_index_by_id.has(selected_entry_id)) {
        return selected_entry_id
      }
    }

    return null
  }, [active_entry_id, entry_index_by_id, selected_entry_ids])

  const statistics_ready = statistics_state.completed_revision === revision
  const completed_statistics_entry_id_set = useMemo<ReadonlySet<TextPreserveEntryId>>(() => {
    return new Set(statistics_state.completed_entry_ids)
  }, [statistics_state.completed_entry_ids])

  const filter_result = useMemo(() => {
    return build_text_preserve_filter_result({
      entries,
      entry_ids,
      filter_state,
    })
  }, [entries, entry_ids, filter_state])

  const filtered_entries = useMemo<TextPreserveVisibleEntry[]>(() => {
    return sort_text_preserve_entries(
      filter_result.visible_entries,
      sort_state,
      statistics_ready,
      statistics_state,
    )
  }, [filter_result.visible_entries, sort_state, statistics_ready, statistics_state])

  const visible_entry_ids = useMemo<TextPreserveEntryId[]>(() => {
    return filtered_entries.map((item) => item.entry_id)
  }, [filtered_entries])

  const visible_entry_id_set = useMemo(() => {
    return new Set(visible_entry_ids)
  }, [visible_entry_ids])

  const has_active_filters = has_active_text_preserve_filters(filter_state)
  const drag_disabled = has_active_filters || sort_state !== null

  const statistics_badge_by_entry_id = useMemo<Record<
    TextPreserveEntryId,
    TextPreserveStatisticsBadgeState
  >>(() => {
    const next_badge_by_entry_id: Record<
      TextPreserveEntryId,
      TextPreserveStatisticsBadgeState
    > = {}
    if (!statistics_ready) {
      return next_badge_by_entry_id
    }

    entries.forEach((entry, index) => {
      const entry_id = entry_ids[index]
      if (entry_id === undefined) {
        return
      }

      const kind = resolve_text_preserve_statistics_badge_kind(
        entry_id,
        statistics_state,
        completed_statistics_entry_id_set,
      )
      if (kind === null) {
        return
      }

      const matched_count = statistics_state.matched_count_by_entry_id[entry_id] ?? 0
      const subset_parent_labels = statistics_state.subset_parent_labels_by_entry_id[entry_id] ?? []

      next_badge_by_entry_id[entry_id] = {
        kind,
        matched_count,
        subset_parent_labels,
        tooltip: build_statistics_badge_tooltip(
          t,
          entry,
          matched_count,
          subset_parent_labels,
        ),
      }
    })

    return next_badge_by_entry_id
  }, [
    completed_statistics_entry_id_set,
    entries,
    entry_ids,
    statistics_ready,
    statistics_state,
    t,
  ])

  const apply_snapshot = useCallback((snapshot: TextPreserveSnapshot): void => {
    set_revision(snapshot.revision)
    set_mode(normalize_mode(snapshot.meta.mode))
    set_entries(snapshot.entries.map((entry) => {
      return normalize_entry(entry)
    }))
  }, [])

  const invalidate_statistics = useCallback((): void => {
    set_statistics_state(create_empty_statistics_state())
  }, [])

  const clear_selection_state = useCallback((): void => {
    set_selected_entry_ids([])
    set_active_entry_id(null)
    set_selection_anchor_entry_id(null)
  }, [])

  const push_action_error_toast = useCallback((error: unknown): void => {
    push_toast(
      'error',
      resolve_text_preserve_error_message(error, unknown_error_message),
    )
  }, [push_toast, unknown_error_message])

  const apply_store_snapshot = useCallback((): void => {
    const preserve_slice = getQualityRuleSlice(
      project_store_state.quality,
      'text_preserve',
    )
    apply_snapshot({
      revision: preserve_slice.revision,
      meta: {
        mode: preserve_slice.mode,
      },
      entries: preserve_slice.entries,
    })
  }, [apply_snapshot, project_store_state.quality])

  const save_entries_snapshot = useCallback(async (
    next_entries: TextPreserveEntry[],
  ): Promise<boolean> => {
    const current_preserve_slice = getQualityRuleSlice(
      project_store.getState().quality,
      TEXT_PRESERVE_RULE_TYPE,
    )
    const normalized_entries = next_entries.map((entry) => {
      return normalize_entry(entry)
    })
    const next_quality_state = replaceQualityRuleSlice(
      project_store.getState().quality,
      TEXT_PRESERVE_RULE_TYPE,
      {
        ...current_preserve_slice,
        entries: normalized_entries,
        revision: current_preserve_slice.revision + 1,
      },
    )
    const local_commit = commit_local_project_patch({
      source: 'quality_rule_save_entries',
      updatedSections: ['quality'],
      patch: [
        createProjectStoreReplaceSectionPatch('quality', next_quality_state),
      ],
    })

    try {
      await api_fetch<TextPreserveMutationAckPayload>(
        '/api/v2/quality/rules/save-entries',
        {
          rule_type: TEXT_PRESERVE_RULE_TYPE,
          expected_revision: current_preserve_slice.revision,
          entries: normalized_entries,
        },
      )
      return true
    } catch (error) {
      local_commit.rollback()
      push_action_error_toast(error)
      return false
    }
  }, [commit_local_project_patch, project_store, push_action_error_toast])

  const persist_merged_entries = useCallback(async (
    incoming_entries: TextPreserveEntry[],
    options: {
      close_preset_menu: boolean
    },
  ): Promise<boolean> => {
    const { merged_entries, report } = merge_text_preserve_entries(
      entries,
      incoming_entries,
    )
    const saved = await save_entries_snapshot(merged_entries)
    if (!saved) {
      return false
    }

    invalidate_statistics()
    clear_selection_state()
    push_toast('success', t('text_preserve_page.feedback.import_success'))

    if (report.updated > 0 || report.deduped > 0) {
      push_toast('warning', t('text_preserve_page.feedback.merge_warning'))
    }

    if (options.close_preset_menu) {
      set_preset_menu_open(false)
    }

    return true
  }, [clear_selection_state, entries, invalidate_statistics, push_toast, save_entries_snapshot, t])

  const refresh_preset_menu = useCallback(async (): Promise<void> => {
    const preset_payload = await api_fetch<TextPreservePresetPayload>(
      '/api/v2/quality/rules/presets',
      {
        preset_dir_name: TEXT_PRESERVE_PRESET_DIR_NAME,
      },
    )
    const default_virtual_id = String(
      settings_snapshot[TEXT_PRESERVE_DEFAULT_PRESET_SETTINGS_KEY] ?? '',
    )

    set_preset_items(
      decorate_preset_items(
        preset_payload.builtin_presets,
        preset_payload.user_presets,
        default_virtual_id,
      ),
    )
  }, [settings_snapshot])

  useEffect(() => {
    if (!project_snapshot.loaded) {
      apply_snapshot({
        revision: 0,
        meta: {
          mode: DEFAULT_MODE,
        },
        entries: [],
      })
      return
    }

    apply_store_snapshot()
  }, [apply_snapshot, apply_store_snapshot, project_snapshot.loaded, project_snapshot.path])

  useEffect(() => {
    if (statistics_ready || sort_state?.column_id !== 'statistics') {
      return
    }

    set_sort_state(null)
  }, [sort_state, statistics_ready])

  useEffect(() => {
    set_selected_entry_ids((previous_ids) => {
      return previous_ids.filter((entry_id) => {
        return entry_index_by_id.has(entry_id) && visible_entry_id_set.has(entry_id)
      })
    })

    if (active_entry_id !== null && !visible_entry_id_set.has(active_entry_id)) {
      set_active_entry_id(null)
    }

    if (
      selection_anchor_entry_id !== null
      && !visible_entry_id_set.has(selection_anchor_entry_id)
    ) {
      set_selection_anchor_entry_id(null)
    }
  }, [active_entry_id, entry_index_by_id, selection_anchor_entry_id, visible_entry_id_set])

  const update_filter_keyword = useCallback((next_keyword: string): void => {
    set_filter_state((previous_state) => {
      return {
        ...previous_state,
        keyword: next_keyword,
      }
    })
  }, [])

  const update_filter_scope = useCallback((next_scope: TextPreserveFilterScope): void => {
    set_filter_state((previous_state) => {
      return {
        ...previous_state,
        scope: next_scope,
      }
    })
  }, [])

  const update_filter_regex = useCallback((next_is_regex: boolean): void => {
    set_filter_state((previous_state) => {
      return {
        ...previous_state,
        is_regex: next_is_regex,
      }
    })
  }, [])

  const apply_table_sort_state = useCallback((next_sort_state: AppTableSortState | null): void => {
    set_sort_state(next_sort_state)
  }, [])

  const apply_table_selection = useCallback((payload: AppTableSelectionChange): void => {
    set_selected_entry_ids((previous_ids) => {
      return are_text_preserve_entry_ids_equal(previous_ids, payload.selected_row_ids)
        ? previous_ids
        : payload.selected_row_ids
    })
    set_active_entry_id((previous_entry_id) => {
      return previous_entry_id === payload.active_row_id
        ? previous_entry_id
        : payload.active_row_id
    })
    set_selection_anchor_entry_id((previous_entry_id) => {
      return previous_entry_id === payload.anchor_row_id
        ? previous_entry_id
        : payload.anchor_row_id
    })
  }, [])

  const update_mode = useCallback(async (next_mode: TextPreserveMode): Promise<void> => {
    const previous_mode = mode_ref.current
    if (mode_update_in_flight_ref.current || previous_mode === next_mode) {
      return
    }

    mode_update_in_flight_ref.current = true
    set_mode_updating(true)
    const barrier_checkpoint = create_barrier_checkpoint()
    let snapshot_committed = false

    try {
      await run_modal_progress_toast({
        message: t('text_preserve_page.mode.loading_toast'),
        timeout_ms: TEXT_PRESERVE_MODE_REFRESH_TIMEOUT_MS,
        task: async () => {
          const current_preserve_slice = getQualityRuleSlice(
            project_store.getState().quality,
            TEXT_PRESERVE_RULE_TYPE,
          )
          const next_quality_state = replaceQualityRuleSlice(
            project_store.getState().quality,
            TEXT_PRESERVE_RULE_TYPE,
            {
              ...current_preserve_slice,
              mode: next_mode,
              revision: current_preserve_slice.revision + 1,
            },
          )
          const local_commit = commit_local_project_patch({
            source: 'quality_rule_meta',
            updatedSections: ['quality'],
            patch: [
              createProjectStoreReplaceSectionPatch('quality', next_quality_state),
            ],
          })

          snapshot_committed = true

          try {
            await api_fetch<TextPreserveMutationAckPayload>(
              '/api/v2/quality/rules/update-meta',
              {
                rule_type: TEXT_PRESERVE_RULE_TYPE,
                expected_revision: current_preserve_slice.revision,
                meta: {
                  mode: next_mode,
                },
              },
            )
          } catch (error) {
            local_commit.rollback()
            throw error
          }

          try {
            await wait_for_barrier('proofreading_cache_refresh', {
              checkpoint: barrier_checkpoint,
            })
          } catch (error) {
            if (!is_modal_progress_timeout_error(error)) {
              local_commit.rollback()
            }
            throw error
          }
        },
      })
    } catch (error) {
      if (snapshot_committed && is_modal_progress_timeout_error(error)) {
        push_toast(
          'warning',
          t('text_preserve_page.feedback.mode_refresh_pending'),
        )
      } else {
        set_mode(previous_mode)
        push_action_error_toast(error)
      }
    } finally {
      mode_update_in_flight_ref.current = false
      set_mode_updating(false)
    }
  }, [
    commit_local_project_patch,
    create_barrier_checkpoint,
    project_store,
    push_toast,
    push_action_error_toast,
    run_modal_progress_toast,
    t,
    wait_for_barrier,
  ])

  const open_create_dialog = useCallback((): void => {
    const insert_after_entry_id = resolve_create_insert_after_entry_id()

    clear_selection_state()
    set_dialog_state({
      open: true,
      mode: 'create',
      target_entry_id: null,
      insert_after_entry_id,
      draft_entry: clone_entry(EMPTY_ENTRY),
      dirty: false,
      saving: false,
      validation_message: null,
    })
  }, [clear_selection_state, resolve_create_insert_after_entry_id])

  const open_edit_dialog = useCallback((entry_id: TextPreserveEntryId): void => {
    const target_index = entry_index_by_id.get(entry_id)
    const target_entry = target_index === undefined
      ? null
      : entries[target_index]

    if (target_entry === null || target_entry === undefined) {
      return
    }

    set_active_entry_id(entry_id)
    set_selected_entry_ids([entry_id])
    set_selection_anchor_entry_id(entry_id)
    set_dialog_state({
      open: true,
      mode: 'edit',
      target_entry_id: entry_id,
      insert_after_entry_id: null,
      draft_entry: clone_entry(target_entry),
      dirty: false,
      saving: false,
      validation_message: null,
    })
  }, [entries, entry_index_by_id])

  const update_dialog_draft = useCallback((patch: Partial<TextPreserveEntry>): void => {
    set_dialog_state((previous_state) => {
      return {
        ...previous_state,
        dirty: true,
        validation_message: null,
        draft_entry: {
          ...previous_state.draft_entry,
          ...patch,
        },
      }
    })
  }, [])

  const commit_remove_entry_ids = useCallback(async (
    target_entry_ids: TextPreserveEntryId[],
  ): Promise<boolean> => {
    if (target_entry_ids.length === 0) {
      return true
    }

    const target_set = new Set(target_entry_ids)
    const previous_entries = entries
    const previous_selected_entry_ids = selected_entry_ids
    const previous_active_entry_id = active_entry_id
    const previous_anchor_entry_id = selection_anchor_entry_id
    const next_entries = entries.filter((_entry, index) => {
      return !target_set.has(entry_ids[index] ?? '')
    })

    invalidate_statistics()
    set_entries(next_entries)
    clear_selection_state()

    const saved = await save_entries_snapshot(next_entries)
    if (!saved) {
      set_entries(previous_entries)
      set_selected_entry_ids(previous_selected_entry_ids)
      set_active_entry_id(previous_active_entry_id)
      set_selection_anchor_entry_id(previous_anchor_entry_id)
      return false
    }

    set_dialog_state(create_empty_dialog_state())
    return true
  }, [
    active_entry_id,
    clear_selection_state,
    entries,
    entry_ids,
    invalidate_statistics,
    save_entries_snapshot,
    selected_entry_ids,
    selection_anchor_entry_id,
  ])

  const delete_selected_entries = useCallback(async (): Promise<void> => {
    if (selected_entry_ids.length === 0) {
      return
    }

    set_confirm_state({
      open: true,
      kind: 'delete-selection',
      selection_count: selected_entry_ids.length,
      preset_name: '',
      preset_input_value: '',
      submitting: false,
      target_virtual_id: null,
    })
  }, [selected_entry_ids])

  const reorder_selected_entries = useCallback(async (
    current_active_entry_id: TextPreserveEntryId,
    over_entry_id: TextPreserveEntryId,
  ): Promise<void> => {
    if (drag_disabled || current_active_entry_id === over_entry_id) {
      return
    }

    const previous_entries = entries
    const next_entries = reorder_text_preserve_selected_group(
      entries,
      entry_ids,
      selected_entry_ids,
      current_active_entry_id,
      over_entry_id,
    )

    invalidate_statistics()
    set_entries(next_entries)
    const saved = await save_entries_snapshot(next_entries)
    if (!saved) {
      set_entries(previous_entries)
    }
  }, [drag_disabled, entries, entry_ids, invalidate_statistics, save_entries_snapshot, selected_entry_ids])

  const query_entry_source = useCallback(async (
    entry_id: TextPreserveEntryId,
  ): Promise<void> => {
    const target_index = entry_index_by_id.get(entry_id)
    const target_entry = target_index === undefined
      ? null
      : entries[target_index]
    if (target_entry === null || target_entry === undefined) {
      return
    }

    try {
      push_proofreading_lookup_intent(buildProofreadingLookupQuery({
        rule_type: TEXT_PRESERVE_RULE_TYPE,
        entry: normalize_entry(target_entry),
      }))
      navigate_to_route('proofreading')
    } catch (error) {
      push_action_error_toast(error)
    }
  }, [
    entries,
    entry_index_by_id,
    navigate_to_route,
    push_proofreading_lookup_intent,
    push_action_error_toast,
  ])

  const search_entry_relations_from_statistics = useCallback((entry_id: TextPreserveEntryId): void => {
    const target_index = entry_index_by_id.get(entry_id)
    const target_entry = target_index === undefined
      ? null
      : entries[target_index]
    if (target_entry === null || target_entry === undefined) {
      return
    }

    set_filter_state({
      keyword: target_entry.src,
      scope: 'src',
      is_regex: false,
    })
    set_sort_state(null)
  }, [entries, entry_index_by_id])

  const import_entries_from_path = useCallback(async (path: string): Promise<void> => {
    try {
      if (path.trim() === '') {
        return
      }

      const payload = await api_fetch<{ entries?: Array<Record<string, unknown>> }>(
        '/api/v2/quality/rules/import',
        {
          rule_type: TEXT_PRESERVE_RULE_TYPE,
          expected_revision: revision_ref.current,
          path,
        },
      )
      const imported_entries = Array.isArray(payload.entries)
        ? payload.entries.map((entry) => {
            return normalize_imported_entry(entry)
          })
        : []
      if (imported_entries.length === 0) {
        push_toast('warning', t('app.feedback.no_valid_data'))
        return
      }

      await persist_merged_entries(
        imported_entries,
        { close_preset_menu: false },
      )
    } catch (error) {
      push_action_error_toast(error)
    }
  }, [persist_merged_entries, push_action_error_toast, push_toast, t])

  const import_entries_from_picker = useCallback(async (): Promise<void> => {
    const pick_result = await window.desktopApp.pickGlossaryImportFilePath()
    if (pick_result.canceled || pick_result.path === null) {
      return
    }

    await import_entries_from_path(pick_result.path)
  }, [import_entries_from_path])

  const export_entries_from_picker = useCallback(async (): Promise<void> => {
    try {
      const pick_result = await window.desktopApp.pickGlossaryExportPath(
        TEXT_PRESERVE_EXPORT_FILE_NAME,
      )
      if (pick_result.canceled || pick_result.path === null) {
        return
      }

      await api_fetch(
        '/api/v2/quality/rules/export',
        {
          rule_type: TEXT_PRESERVE_RULE_TYPE,
          path: pick_result.path,
          entries: entries.map((entry) => {
            return normalize_entry(entry)
          }),
        },
      )
      push_toast('success', t('text_preserve_page.feedback.export_success'))
    } catch (error) {
      push_action_error_toast(error)
    }
  }, [entries, push_action_error_toast, push_toast, t])

  const run_statistics = useCallback(async (): Promise<void> => {
    if (statistics_state.running) {
      return
    }

    const effective_entries = entries.flatMap((entry, index) => {
      if (entry.src === '') {
        return []
      }

      return [{
        entry,
        entry_id: entry_ids[index] ?? build_text_preserve_entry_id(entry, index),
      }]
    })

    set_statistics_state({
      running: true,
      completed_revision: null,
      completed_entry_ids: [],
      matched_count_by_entry_id: {},
      subset_parent_labels_by_entry_id: {},
    })

    try {
      const item_texts = collect_project_item_texts(project_store.getState().items)
      const worker_result = await run_quality_statistics_task({
        rules: effective_entries.map((item) => ({
          key: item.entry_id,
          pattern: item.entry.src,
          mode: TEXT_PRESERVE_RULE_TYPE,
          regex: true,
          case_sensitive: false,
        })),
        srcTexts: item_texts.srcTexts,
        dstTexts: item_texts.dstTexts,
        relationCandidates: effective_entries.map((item) => ({
          key: item.entry_id,
          src: item.entry.src,
        })),
      })
      const results = worker_result.results

      set_statistics_state({
        running: false,
        completed_revision: revision_ref.current,
        completed_entry_ids: effective_entries.map((item) => {
          return item.entry_id
        }),
        matched_count_by_entry_id: Object.fromEntries(
          Object.entries(results).map(([entry_id, result]) => {
            return [entry_id, result.matched_item_count ?? 0]
          }),
        ),
        subset_parent_labels_by_entry_id: Object.fromEntries(
          Object.entries(results).map(([entry_id, result]) => {
            return [entry_id, result.subset_parents ?? []]
          }),
        ),
      })
    } catch (error) {
      set_statistics_state(create_empty_statistics_state())
      push_action_error_toast(error)
    }
  }, [entries, entry_ids, project_store, push_action_error_toast, statistics_state.running])

  const open_preset_menu = useCallback(async (): Promise<void> => {
    try {
      await refresh_preset_menu()
      set_preset_menu_open(true)
    } catch (error) {
      set_preset_menu_open(false)
      push_action_error_toast(error)
    }
  }, [push_action_error_toast, refresh_preset_menu])

  const apply_preset = useCallback(async (virtual_id: string): Promise<void> => {
    try {
      const payload = await api_fetch<{ entries: Array<Record<string, unknown>> }>(
        '/api/v2/quality/rules/presets/read',
        {
          preset_dir_name: TEXT_PRESERVE_PRESET_DIR_NAME,
          virtual_id,
        },
      )
      await persist_merged_entries(
        payload.entries.map((entry) => {
          return normalize_imported_entry(entry)
        }),
        { close_preset_menu: true },
      )
    } catch (error) {
      push_action_error_toast(error)
    }
  }, [persist_merged_entries, push_action_error_toast])

  const request_reset_entries = useCallback((): void => {
    set_confirm_state({
      open: true,
      kind: 'reset',
      selection_count: 0,
      preset_name: '',
      preset_input_value: '',
      submitting: false,
      target_virtual_id: null,
    })
  }, [])

  const request_save_preset = useCallback((): void => {
    set_preset_input_state({
      open: true,
      mode: 'save',
      value: '',
      submitting: false,
      target_virtual_id: null,
    })
  }, [])

  const request_rename_preset = useCallback((preset_item: TextPreservePresetItem): void => {
    set_preset_input_state({
      open: true,
      mode: 'rename',
      value: preset_item.name,
      submitting: false,
      target_virtual_id: preset_item.virtual_id,
    })
  }, [])

  const request_delete_preset = useCallback((preset_item: TextPreservePresetItem): void => {
    set_confirm_state({
      open: true,
      kind: 'delete-preset',
      selection_count: 0,
      preset_name: preset_item.name,
      preset_input_value: '',
      submitting: false,
      target_virtual_id: preset_item.virtual_id,
    })
  }, [])

  const save_preset = useCallback(async (name: string): Promise<boolean> => {
    const normalized_name = normalize_preset_name(name)
    if (normalized_name === '') {
      push_toast('warning', t('text_preserve_page.feedback.preset_name_required'))
      return false
    }

    try {
      await api_fetch(
        '/api/v2/quality/rules/presets/save',
        {
          preset_dir_name: TEXT_PRESERVE_PRESET_DIR_NAME,
          name: normalized_name,
          entries: entries
            .map((entry) => {
              return normalize_entry(entry)
            })
            .filter((entry) => entry.src !== ''),
        },
      )
      await refresh_preset_menu()
      push_toast('success', t('text_preserve_page.feedback.preset_saved'))
      return true
    } catch (error) {
      push_action_error_toast(error)
      return false
    }
  }, [entries, push_action_error_toast, push_toast, refresh_preset_menu, t])

  const rename_preset = useCallback(async (
    virtual_id: string,
    name: string,
  ): Promise<boolean> => {
    const normalized_name = normalize_preset_name(name)
    if (normalized_name === '') {
      push_toast('warning', t('text_preserve_page.feedback.preset_name_required'))
      return false
    }

    try {
      const payload = await api_fetch<{ item?: TextPreservePresetItem }>(
        '/api/v2/quality/rules/presets/rename',
        {
          preset_dir_name: TEXT_PRESERVE_PRESET_DIR_NAME,
          virtual_id,
          new_name: normalized_name,
        },
      )
      const target_preset = preset_items.find((item) => item.virtual_id === virtual_id)
      if (target_preset?.is_default) {
        const settings_payload = await api_fetch<SettingsSnapshotPayload>(
          '/api/settings/update',
          build_default_preset_update_payload(
            String(payload.item?.virtual_id ?? ''),
          ),
        )
        set_settings_snapshot(normalize_settings_snapshot(settings_payload))
      }
      await refresh_preset_menu()
      push_toast('success', t('text_preserve_page.feedback.preset_renamed'))
      return true
    } catch (error) {
      push_action_error_toast(error)
      return false
    }
  }, [preset_items, push_action_error_toast, push_toast, refresh_preset_menu, set_settings_snapshot, t])

  const set_default_preset = useCallback(async (virtual_id: string): Promise<void> => {
    try {
      const payload = await api_fetch<SettingsSnapshotPayload>(
        '/api/settings/update',
        build_default_preset_update_payload(virtual_id),
      )
      set_settings_snapshot(normalize_settings_snapshot(payload))
      await refresh_preset_menu()
      push_toast('success', t('text_preserve_page.feedback.default_preset_set'))
    } catch (error) {
      push_action_error_toast(error)
    }
  }, [push_action_error_toast, push_toast, refresh_preset_menu, set_settings_snapshot, t])

  const cancel_default_preset = useCallback(async (): Promise<void> => {
    try {
      const payload = await api_fetch<SettingsSnapshotPayload>(
        '/api/settings/update',
        build_default_preset_update_payload(''),
      )
      set_settings_snapshot(normalize_settings_snapshot(payload))
      await refresh_preset_menu()
      push_toast('success', t('text_preserve_page.feedback.default_preset_cleared'))
    } catch (error) {
      push_action_error_toast(error)
    }
  }, [push_action_error_toast, push_toast, refresh_preset_menu, set_settings_snapshot, t])

  const validate_entry = useCallback((entry: TextPreserveEntry): string | null => {
    if (entry.src === '') {
      return null
    }

    try {
      void new RegExp(entry.src, 'i')
      return null
    } catch (error) {
      const detail = error instanceof Error ? error.message : ''
      return `${t('text_preserve_page.feedback.regex_invalid')}: ${detail}`
    }
  }, [t])

  const persist_dialog_entry = useCallback(async (): Promise<boolean> => {
    const normalized_entry = normalize_entry(dialog_state.draft_entry)
    const validation_message = validate_entry(normalized_entry)
    if (validation_message !== null) {
      set_dialog_state((previous_state) => {
        return {
          ...previous_state,
          validation_message,
        }
      })
      push_toast('error', validation_message)
      return false
    }

    set_dialog_state((previous_state) => ({
      ...previous_state,
      saving: true,
      validation_message: null,
    }))

    const next_entries = dialog_state.mode === 'create'
      ? (() => {
          const insert_after_index = dialog_state.insert_after_entry_id === null
            ? -1
            : entry_ids.findIndex((entry_id) => entry_id === dialog_state.insert_after_entry_id)
          const insert_index = insert_after_index < 0
            ? entries.length
            : insert_after_index + 1
          const draft_entries = [...entries]

          draft_entries.splice(insert_index, 0, normalized_entry)
          return draft_entries
        })()
      : entries.map((entry, index) => {
          return entry_ids[index] === dialog_state.target_entry_id
            ? {
                ...entry,
                ...normalized_entry,
              }
            : entry
        })

    invalidate_statistics()
    const saved = await save_entries_snapshot(next_entries)
    if (saved) {
      push_toast('success', t('app.feedback.save_success'))
      set_dialog_state(create_empty_dialog_state())
      return true
    }

    set_dialog_state((previous_state) => ({
      ...previous_state,
      saving: false,
    }))
    return false
  }, [dialog_state, entries, entry_ids, invalidate_statistics, push_toast, save_entries_snapshot, t, validate_entry])

  const save_dialog_entry = useCallback(async (): Promise<void> => {
    await persist_dialog_entry()
  }, [persist_dialog_entry])

  const request_close_dialog = useCallback(async (): Promise<void> => {
    set_dialog_state(create_empty_dialog_state())
  }, [])

  const close_confirm_dialog = useCallback((): void => {
    set_confirm_state(create_empty_confirm_state())
  }, [])

  const close_preset_input_dialog = useCallback((): void => {
    set_preset_input_state(create_empty_preset_input_state())
  }, [])

  const update_preset_input_value = useCallback((next_value: string): void => {
    set_preset_input_state((previous_state) => {
      return {
        ...previous_state,
        value: next_value,
      }
    })
  }, [])

  const submit_preset_input = useCallback(async (): Promise<void> => {
    if (!preset_input_state.open || preset_input_state.mode === null) {
      return
    }

    const normalized_name = normalize_preset_name(preset_input_state.value)
    if (normalized_name === '') {
      push_toast('warning', t('text_preserve_page.feedback.preset_name_required'))
      return
    }

    const next_virtual_id = build_user_preset_virtual_id(normalized_name)
    if (
      preset_input_state.mode === 'save'
      && has_casefold_duplicate_preset(preset_items, next_virtual_id, null)
    ) {
      set_confirm_state({
        open: true,
        kind: 'overwrite-preset',
        selection_count: 0,
        preset_name: normalized_name,
        preset_input_value: normalized_name,
        submitting: false,
        target_virtual_id: null,
      })
      return
    }

    if (
      preset_input_state.mode === 'rename'
      && has_casefold_duplicate_preset(
        preset_items,
        next_virtual_id,
        preset_input_state.target_virtual_id,
      )
    ) {
      push_toast('warning', t('text_preserve_page.feedback.preset_exists'))
      return
    }

    set_preset_input_state((previous_state) => {
      return {
        ...previous_state,
        submitting: true,
      }
    })

    const succeeded = preset_input_state.mode === 'save'
      ? await save_preset(normalized_name)
      : preset_input_state.target_virtual_id === null
        ? false
        : await rename_preset(preset_input_state.target_virtual_id, normalized_name)

    if (succeeded) {
      set_preset_input_state(create_empty_preset_input_state())
    } else {
      set_preset_input_state((previous_state) => {
        return {
          ...previous_state,
          submitting: false,
        }
      })
    }
  }, [preset_input_state, preset_items, push_toast, rename_preset, save_preset, t])

  const reset_entries = useCallback(async (): Promise<boolean> => {
    const saved = await save_entries_snapshot([])
    if (!saved) {
      return false
    }

    invalidate_statistics()
    clear_selection_state()
    push_toast('success', t('text_preserve_page.feedback.reset_success'))
    set_preset_menu_open(false)
    return true
  }, [clear_selection_state, invalidate_statistics, push_toast, save_entries_snapshot, t])

  const confirm_pending_action = useCallback(async (): Promise<void> => {
    if (!confirm_state.open || confirm_state.kind === null) {
      return
    }

    set_confirm_state((previous_state) => {
      return {
        ...previous_state,
        submitting: true,
      }
    })

    let succeeded = false

    if (confirm_state.kind === 'delete-selection') {
      succeeded = await commit_remove_entry_ids(selected_entry_ids)
    } else if (confirm_state.kind === 'reset') {
      succeeded = await reset_entries()
    } else if (confirm_state.kind === 'delete-preset') {
      try {
        if (confirm_state.target_virtual_id !== null) {
          await api_fetch(
            '/api/v2/quality/rules/presets/delete',
            {
              preset_dir_name: TEXT_PRESERVE_PRESET_DIR_NAME,
              virtual_id: confirm_state.target_virtual_id,
            },
          )

          const target_preset = preset_items.find((item) => {
            return item.virtual_id === confirm_state.target_virtual_id
          })
          if (target_preset?.is_default) {
            const settings_payload = await api_fetch<SettingsSnapshotPayload>(
              '/api/settings/update',
              build_default_preset_update_payload(''),
            )
            set_settings_snapshot(normalize_settings_snapshot(settings_payload))
          }
          await refresh_preset_menu()
          push_toast('success', t('text_preserve_page.feedback.preset_deleted'))
          succeeded = true
        }
      } catch (error) {
        push_action_error_toast(error)
      }
    } else if (confirm_state.kind === 'overwrite-preset') {
      succeeded = await save_preset(confirm_state.preset_input_value)
      if (succeeded) {
        set_preset_input_state(create_empty_preset_input_state())
      }
    }

    if (succeeded) {
      set_confirm_state(create_empty_confirm_state())
    } else {
      set_confirm_state((previous_state) => {
        return {
          ...previous_state,
          submitting: false,
        }
      })
    }
  }, [
    commit_remove_entry_ids,
    confirm_state,
    preset_items,
    push_toast,
    push_action_error_toast,
    refresh_preset_menu,
    reset_entries,
    save_preset,
    selected_entry_ids,
    set_settings_snapshot,
    t,
  ])

  return {
    title_key: TEXT_PRESERVE_TITLE_KEY,
    mode,
    mode_updating,
    filtered_entries,
    filter_state,
    sort_state,
    invalid_filter_message: filter_result.invalid_regex_message,
    drag_disabled,
    statistics_state,
    statistics_ready,
    statistics_badge_by_entry_id,
    preset_items,
    selected_entry_ids,
    active_entry_id,
    selection_anchor_entry_id,
    preset_menu_open,
    dialog_state,
    confirm_state,
    preset_input_state,
    update_filter_keyword,
    update_filter_scope,
    update_filter_regex,
    apply_table_sort_state,
    apply_table_selection,
    update_mode,
    open_create_dialog,
    open_edit_dialog,
    update_dialog_draft,
    import_entries_from_path,
    import_entries_from_picker,
    export_entries_from_picker,
    run_statistics,
    open_preset_menu,
    apply_preset,
    request_reset_entries,
    request_save_preset,
    request_rename_preset,
    request_delete_preset,
    set_default_preset,
    cancel_default_preset,
    delete_selected_entries,
    reorder_selected_entries,
    query_entry_source,
    search_entry_relations_from_statistics,
    save_dialog_entry,
    request_close_dialog,
    confirm_pending_action,
    close_confirm_dialog,
    update_preset_input_value,
    submit_preset_input,
    close_preset_input_dialog,
    set_preset_menu_open,
  }
}
