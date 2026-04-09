import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api_fetch } from '@/app/desktop-api'
import { useAppNavigation } from '@/app/navigation/navigation-context'
import { useDesktopToast } from '@/app/state/use-desktop-toast'
import { useI18n } from '@/i18n'
import {
  collect_range_selection,
  reorder_selected_group,
} from '@/pages/glossary-page/components/glossary-selection'
import type {
  GlossaryDialogState,
  GlossaryEntry,
  GlossaryEntryId,
  GlossaryPresetItem,
  GlossarySearchState,
  GlossaryStatisticsState,
} from '@/pages/glossary-page/types'

type GlossarySnapshot = {
  revision: number
  meta: {
    enabled?: boolean
  }
  entries: GlossaryEntry[]
}

type GlossarySnapshotPayload = {
  snapshot: GlossarySnapshot
}

type GlossaryStatisticsPayload = {
  statistics?: {
    results?: Record<string, {
      matched_item_count?: number
      subset_parents?: string[]
    }>
  }
}

type GlossaryPresetPayload = {
  builtin_presets: GlossaryPresetItem[]
  user_presets: GlossaryPresetItem[]
}

const EMPTY_ENTRY: GlossaryEntry = {
  src: '',
  dst: '',
  info: '',
  case_sensitive: false,
}

function clone_entry(entry: GlossaryEntry): GlossaryEntry {
  return {
    entry_id: entry.entry_id,
    src: entry.src,
    dst: entry.dst,
    info: entry.info,
    case_sensitive: entry.case_sensitive,
  }
}

function build_glossary_entry_id(
  entry: GlossaryEntry,
  index: number,
): GlossaryEntryId {
  if (typeof entry.entry_id === 'string' && entry.entry_id !== '') {
    return entry.entry_id
  }

  return `${entry.src.trim()}::${index.toString()}`
}

function build_search_state(
  keyword: string,
  entries: GlossaryEntry[],
  current_match_index: number,
): GlossarySearchState {
  const normalized_keyword = keyword.trim().toLowerCase()
  const matched_entry_ids = normalized_keyword === ''
    ? []
    : entries.flatMap((entry, index) => {
        const haystack = [entry.src, entry.dst, entry.info].join('\n').toLowerCase()
        return haystack.includes(normalized_keyword)
          ? [build_glossary_entry_id(entry, index)]
          : []
      })
  const normalized_match_index = matched_entry_ids.length === 0
    ? -1
    : Math.min(
        Math.max(current_match_index, 0),
        matched_entry_ids.length - 1,
      )

  return {
    keyword,
    matched_entry_ids,
    current_match_index: normalized_match_index,
  }
}

function create_empty_statistics_state(): GlossaryStatisticsState {
  return {
    running: false,
    matched_count_by_entry_id: {},
    subset_parent_labels_by_entry_id: {},
  }
}

function create_empty_dialog_state(): GlossaryDialogState {
  return {
    open: false,
    mode: 'create',
    target_entry_id: null,
    draft_entry: clone_entry(EMPTY_ENTRY),
    dirty: false,
    saving: false,
  }
}

function normalize_dialog_entry(entry: GlossaryEntry): GlossaryEntry {
  return {
    src: entry.src.trim(),
    dst: entry.dst.trim(),
    info: entry.info.trim(),
    case_sensitive: entry.case_sensitive,
  }
}

type UseGlossaryPageStateResult = {
  revision: number
  enabled: boolean
  entries: GlossaryEntry[]
  entry_ids: GlossaryEntryId[]
  preset_items: GlossaryPresetItem[]
  selected_entry_ids: GlossaryEntryId[]
  active_entry_id: GlossaryEntryId | null
  preset_menu_open: boolean
  search_state: GlossarySearchState
  statistics_state: GlossaryStatisticsState
  dialog_state: GlossaryDialogState
  update_search_keyword: (next_keyword: string) => void
  focus_previous_match: () => void
  focus_next_match: () => void
  update_enabled: (next_enabled: boolean) => Promise<void>
  open_create_dialog: () => void
  open_edit_dialog: (entry_id: GlossaryEntryId) => void
  update_dialog_draft: (patch: Partial<GlossaryEntry>) => void
  import_entries_from_picker: () => Promise<void>
  export_entries_from_picker: () => Promise<void>
  run_statistics: () => Promise<void>
  open_preset_menu: () => Promise<void>
  apply_preset: (virtual_id: string) => Promise<void>
  select_entry: (
    entry_id: GlossaryEntryId,
    options: { extend: boolean; range: boolean },
  ) => void
  select_range: (
    anchor_entry_id: GlossaryEntryId,
    target_entry_id: GlossaryEntryId,
  ) => void
  box_select_entries: (next_entry_ids: GlossaryEntryId[]) => void
  delete_selected_entries: () => Promise<void>
  toggle_case_sensitive_for_selected: (next_value: boolean) => Promise<void>
  reorder_selected_entries: (
    active_entry_id: GlossaryEntryId,
    over_entry_id: GlossaryEntryId,
  ) => Promise<void>
  save_dialog_entry: () => Promise<void>
  request_close_dialog: () => Promise<void>
  query_dialog_entry: () => Promise<void>
  delete_dialog_entry: () => Promise<void>
  set_preset_menu_open: (next_open: boolean) => void
  refresh_snapshot: () => Promise<void>
}

export function useGlossaryPageState(): UseGlossaryPageStateResult {
  const { t } = useI18n()
  const { push_toast } = useDesktopToast()
  const {
    navigate_to_route,
    push_proofreading_lookup_intent,
  } = useAppNavigation()
  const [revision, set_revision] = useState(0)
  const [enabled, set_enabled] = useState(true)
  const [entries, set_entries] = useState<GlossaryEntry[]>([])
  const [preset_items, set_preset_items] = useState<GlossaryPresetItem[]>([])
  const [selected_entry_ids, set_selected_entry_ids] = useState<GlossaryEntryId[]>([])
  const [active_entry_id, set_active_entry_id] = useState<GlossaryEntryId | null>(null)
  const [selection_anchor_entry_id, set_selection_anchor_entry_id] = useState<GlossaryEntryId | null>(null)
  const [preset_menu_open, set_preset_menu_open] = useState(false)
  const [search_state, set_search_state] = useState<GlossarySearchState>({
    keyword: '',
    matched_entry_ids: [],
    current_match_index: -1,
  })
  const [statistics_state, set_statistics_state] = useState<GlossaryStatisticsState>(() => {
    return create_empty_statistics_state()
  })
  const [dialog_state, set_dialog_state] = useState<GlossaryDialogState>(() => {
    return create_empty_dialog_state()
  })
  const revision_ref = useRef(revision)

  useEffect(() => {
    revision_ref.current = revision
  }, [revision])

  const entry_ids = useMemo<GlossaryEntryId[]>(() => {
    return entries.map((entry, index) => {
      return build_glossary_entry_id(entry, index)
    })
  }, [entries])

  const entry_index_by_id = useMemo(() => {
    return new Map(entry_ids.map((entry_id, index) => [entry_id, index]))
  }, [entry_ids])

  const apply_snapshot = useCallback((snapshot: GlossarySnapshot): void => {
    set_revision(snapshot.revision)
    set_enabled(snapshot.meta.enabled ?? true)
    set_entries(snapshot.entries.map((entry) => clone_entry(entry)))
  }, [])

  const refresh_snapshot = useCallback(async (): Promise<void> => {
    try {
      const payload = await api_fetch<GlossarySnapshotPayload>(
        '/api/quality/rules/snapshot',
        {
          rule_type: 'glossary',
        },
      )
      apply_snapshot(payload.snapshot)
    } catch (error) {
      if (error instanceof Error) {
        push_toast('error', error.message)
      } else {
        push_toast('error', t('glossary_page.feedback.refresh_failed'))
      }
    }
  }, [apply_snapshot, push_toast, t])

  const save_entries_snapshot = useCallback(async (next_entries: GlossaryEntry[]): Promise<boolean> => {
    try {
      const payload = await api_fetch<GlossarySnapshotPayload>(
        '/api/quality/rules/save-entries',
        {
          rule_type: 'glossary',
          expected_revision: revision_ref.current,
          entries: next_entries.map((entry) => {
            return normalize_dialog_entry(entry)
          }),
        },
      )
      apply_snapshot(payload.snapshot)
      return true
    } catch (error) {
      if (error instanceof Error) {
        push_toast('error', error.message)
      } else {
        push_toast('error', t('glossary_page.feedback.save_failed'))
      }
      return false
    }
  }, [apply_snapshot, push_toast, t])

  useEffect(() => {
    void refresh_snapshot()
  }, [refresh_snapshot])

  useEffect(() => {
    set_search_state((previous_state) => {
      return build_search_state(
        previous_state.keyword,
        entries,
        previous_state.current_match_index,
      )
    })
  }, [entries])

  useEffect(() => {
    set_selected_entry_ids((previous_ids) => {
      return previous_ids.filter((entry_id) => entry_index_by_id.has(entry_id))
    })

    if (active_entry_id !== null && !entry_index_by_id.has(active_entry_id)) {
      set_active_entry_id(null)
    }

    if (
      selection_anchor_entry_id !== null
      && !entry_index_by_id.has(selection_anchor_entry_id)
    ) {
      set_selection_anchor_entry_id(null)
    }
  }, [active_entry_id, entry_index_by_id, selection_anchor_entry_id])

  const update_search_keyword = useCallback((next_keyword: string): void => {
    set_search_state((previous_state) => {
      return build_search_state(
        next_keyword,
        entries,
        previous_state.current_match_index,
      )
    })
  }, [entries])

  const focus_previous_match = useCallback((): void => {
    set_search_state((previous_state) => {
      if (previous_state.matched_entry_ids.length === 0) {
        return previous_state
      }

      const current_match_index = previous_state.current_match_index <= 0
        ? previous_state.matched_entry_ids.length - 1
        : previous_state.current_match_index - 1
      const next_active_entry_id = previous_state.matched_entry_ids[current_match_index] ?? null

      if (next_active_entry_id !== null) {
        set_active_entry_id(next_active_entry_id)
        set_selected_entry_ids([next_active_entry_id])
        set_selection_anchor_entry_id(next_active_entry_id)
      }

      return {
        ...previous_state,
        current_match_index,
      }
    })
  }, [])

  const focus_next_match = useCallback((): void => {
    set_search_state((previous_state) => {
      if (previous_state.matched_entry_ids.length === 0) {
        return previous_state
      }

      const current_match_index = previous_state.current_match_index >= previous_state.matched_entry_ids.length - 1
        ? 0
        : previous_state.current_match_index + 1
      const next_active_entry_id = previous_state.matched_entry_ids[current_match_index] ?? null

      if (next_active_entry_id !== null) {
        set_active_entry_id(next_active_entry_id)
        set_selected_entry_ids([next_active_entry_id])
        set_selection_anchor_entry_id(next_active_entry_id)
      }

      return {
        ...previous_state,
        current_match_index,
      }
    })
  }, [])

  const update_enabled = useCallback(async (next_enabled: boolean): Promise<void> => {
    const previous_enabled = enabled
    set_enabled(next_enabled)

    try {
      const payload = await api_fetch<GlossarySnapshotPayload>(
        '/api/quality/rules/update-meta',
        {
          rule_type: 'glossary',
          expected_revision: revision_ref.current,
          meta: {
            enabled: next_enabled,
          },
        },
      )
      apply_snapshot(payload.snapshot)
    } catch (error) {
      set_enabled(previous_enabled)
      if (error instanceof Error) {
        push_toast('error', error.message)
      } else {
        push_toast('error', t('glossary_page.feedback.save_failed'))
      }
    }
  }, [apply_snapshot, enabled, push_toast, t])

  const open_create_dialog = useCallback((): void => {
    set_dialog_state({
      open: true,
      mode: 'create',
      target_entry_id: null,
      draft_entry: clone_entry(EMPTY_ENTRY),
      dirty: false,
      saving: false,
    })
  }, [])

  const open_edit_dialog = useCallback((entry_id: GlossaryEntryId): void => {
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
      draft_entry: clone_entry(target_entry),
      dirty: false,
      saving: false,
    })
  }, [entries, entry_index_by_id])

  const update_dialog_draft = useCallback((patch: Partial<GlossaryEntry>): void => {
    set_dialog_state((previous_state) => {
      return {
        ...previous_state,
        dirty: true,
        draft_entry: {
          ...previous_state.draft_entry,
          ...patch,
        },
      }
    })
  }, [])

  const select_entry = useCallback((
    entry_id: GlossaryEntryId,
    options: { extend: boolean; range: boolean },
  ): void => {
    set_active_entry_id(entry_id)

    if (options.range) {
      set_selected_entry_ids(
        collect_range_selection(
          entry_ids,
          selection_anchor_entry_id,
          entry_id,
        ),
      )
      return
    }

    if (options.extend) {
      set_selected_entry_ids((previous_ids) => {
        return previous_ids.includes(entry_id)
          ? previous_ids.filter((current_id) => current_id !== entry_id)
          : [...previous_ids, entry_id]
      })
      set_selection_anchor_entry_id(entry_id)
      return
    }

    set_selected_entry_ids([entry_id])
    set_selection_anchor_entry_id(entry_id)
  }, [entry_ids, selection_anchor_entry_id])

  const select_range = useCallback((
    anchor_entry_id: GlossaryEntryId,
    target_entry_id: GlossaryEntryId,
  ): void => {
    set_selected_entry_ids(
      collect_range_selection(entry_ids, anchor_entry_id, target_entry_id),
    )
    set_active_entry_id(target_entry_id)
    set_selection_anchor_entry_id(anchor_entry_id)
  }, [entry_ids])

  const box_select_entries = useCallback((next_entry_ids: GlossaryEntryId[]): void => {
    set_selected_entry_ids(next_entry_ids)
    set_active_entry_id(next_entry_ids.at(-1) ?? null)
    set_selection_anchor_entry_id(next_entry_ids[0] ?? null)
  }, [])

  const delete_selected_entries = useCallback(async (): Promise<void> => {
    if (selected_entry_ids.length === 0) {
      return
    }

    const selected_set = new Set(selected_entry_ids)
    const previous_entries = entries
    const next_entries = entries.filter((_entry, index) => {
      return !selected_set.has(entry_ids[index] ?? '')
    })

    set_entries(next_entries)
    set_selected_entry_ids([])
    set_active_entry_id(null)
    set_selection_anchor_entry_id(null)

    const saved = await save_entries_snapshot(next_entries)
    if (!saved) {
      set_entries(previous_entries)
    }
  }, [entries, entry_ids, save_entries_snapshot, selected_entry_ids])

  const toggle_case_sensitive_for_selected = useCallback(async (next_value: boolean): Promise<void> => {
    if (selected_entry_ids.length === 0) {
      return
    }

    const selected_set = new Set(selected_entry_ids)
    const previous_entries = entries
    const next_entries = entries.map((entry, index) => {
      if (!selected_set.has(entry_ids[index] ?? '')) {
        return entry
      }

      return {
        ...entry,
        case_sensitive: next_value,
      }
    })

    set_entries(next_entries)
    const saved = await save_entries_snapshot(next_entries)
    if (!saved) {
      set_entries(previous_entries)
    }
  }, [entries, entry_ids, save_entries_snapshot, selected_entry_ids])

  const reorder_selected_entries = useCallback(async (
    current_active_entry_id: GlossaryEntryId,
    over_entry_id: GlossaryEntryId,
  ): Promise<void> => {
    if (current_active_entry_id === over_entry_id) {
      return
    }

    const previous_entries = entries
    const next_entries = reorder_selected_group(
      entries,
      entry_ids,
      selected_entry_ids,
      current_active_entry_id,
      over_entry_id,
    )

    set_entries(next_entries)
    const saved = await save_entries_snapshot(next_entries)
    if (!saved) {
      set_entries(previous_entries)
    }
  }, [entries, entry_ids, save_entries_snapshot, selected_entry_ids])

  const persist_dialog_entry = useCallback(async (): Promise<boolean> => {
    const normalized_entry = normalize_dialog_entry(dialog_state.draft_entry)

    if (normalized_entry.src === '') {
      push_toast('error', t('glossary_page.feedback.source_required'))
      return false
    }

    set_dialog_state((previous_state) => ({
      ...previous_state,
      saving: true,
    }))

    const next_entries = dialog_state.mode === 'create'
      ? active_entry_id === null
        ? [...entries, normalized_entry]
        : (() => {
            const insert_index = entry_ids.indexOf(active_entry_id)
            const resolved_insert_index = insert_index < 0
              ? entries.length
              : insert_index + 1
            const cloned_entries = [...entries]
            cloned_entries.splice(resolved_insert_index, 0, normalized_entry)
            return cloned_entries
          })()
      : entries.map((entry, index) => {
          return entry_ids[index] === dialog_state.target_entry_id
            ? {
                ...entry,
                ...normalized_entry,
              }
            : entry
        })

    const saved = await save_entries_snapshot(next_entries)
    if (saved) {
      set_dialog_state(create_empty_dialog_state())
      return true
    }

    set_dialog_state((previous_state) => ({
      ...previous_state,
      saving: false,
    }))
    return false
  }, [active_entry_id, dialog_state, entries, entry_ids, push_toast, save_entries_snapshot, t])

  const save_dialog_entry = useCallback(async (): Promise<void> => {
    await persist_dialog_entry()
  }, [persist_dialog_entry])

  const request_close_dialog = useCallback(async (): Promise<void> => {
    if (!dialog_state.dirty) {
      set_dialog_state(create_empty_dialog_state())
      return
    }

    await save_dialog_entry()
  }, [dialog_state.dirty, save_dialog_entry])

  const query_dialog_entry = useCallback(async (): Promise<void> => {
    const normalized_entry = normalize_dialog_entry(dialog_state.draft_entry)

    if (dialog_state.dirty) {
      const saved = await persist_dialog_entry()
      if (!saved) {
        return
      }
    }

    try {
      const payload = await api_fetch<{ query: { keyword: string; is_regex: boolean } }>(
        '/api/quality/rules/query-proofreading',
        {
          rule_type: 'glossary',
          entry: normalized_entry,
        },
      )
      push_proofreading_lookup_intent(payload.query)
      navigate_to_route('proofreading')
    } catch (error) {
      if (error instanceof Error) {
        push_toast('error', error.message)
      } else {
        push_toast('error', t('glossary_page.feedback.query_failed'))
      }
    }
  }, [dialog_state.dirty, dialog_state.draft_entry, navigate_to_route, persist_dialog_entry, push_proofreading_lookup_intent, push_toast, t])

  const delete_dialog_entry = useCallback(async (): Promise<void> => {
    if (dialog_state.mode === 'create') {
      set_dialog_state(create_empty_dialog_state())
      return
    }

    const previous_entries = entries
    const next_entries = entries.filter((_entry, index) => {
      return entry_ids[index] !== dialog_state.target_entry_id
    })

    set_entries(next_entries)
    const saved = await save_entries_snapshot(next_entries)
    if (saved) {
      set_dialog_state(create_empty_dialog_state())
      return
    }

    set_entries(previous_entries)
  }, [dialog_state.mode, dialog_state.target_entry_id, entries, entry_ids, save_entries_snapshot])

  const import_entries_from_picker = useCallback(async (): Promise<void> => {
    try {
      const pick_result = await window.desktopApp.pickGlossaryImportFilePath()
      if (pick_result.canceled || pick_result.path === null) {
        return
      }

      const payload = await api_fetch<{ entries: GlossaryEntry[] }>(
        '/api/quality/rules/import',
        {
          rule_type: 'glossary',
          expected_revision: revision_ref.current,
          path: pick_result.path,
        },
      )
      await save_entries_snapshot(payload.entries)
    } catch (error) {
      if (error instanceof Error) {
        push_toast('error', error.message)
      } else {
        push_toast('error', t('glossary_page.feedback.import_failed'))
      }
    }
  }, [push_toast, save_entries_snapshot, t])

  const export_entries_from_picker = useCallback(async (): Promise<void> => {
    try {
      const pick_result = await window.desktopApp.pickGlossaryExportPath('glossary.json')
      if (pick_result.canceled || pick_result.path === null) {
        return
      }

      await api_fetch(
        '/api/quality/rules/export',
        {
          rule_type: 'glossary',
          path: pick_result.path,
          entries: entries.map((entry) => {
            return normalize_dialog_entry(entry)
          }),
        },
      )
    } catch (error) {
      if (error instanceof Error) {
        push_toast('error', error.message)
      } else {
        push_toast('error', t('glossary_page.feedback.export_failed'))
      }
    }
  }, [entries, push_toast, t])

  const run_statistics = useCallback(async (): Promise<void> => {
    set_statistics_state((previous_state) => ({
      ...previous_state,
      running: true,
    }))

    try {
      const payload = await api_fetch<GlossaryStatisticsPayload>(
        '/api/quality/rules/statistics',
        {
          rules: entries.map((entry, index) => ({
            key: build_glossary_entry_id(entry, index),
            pattern: entry.src,
            mode: 'glossary',
            regex: false,
            case_sensitive: entry.case_sensitive,
          })),
          relation_candidates: entries.map((entry, index) => ({
            key: build_glossary_entry_id(entry, index),
            src: entry.src,
          })),
        },
      )
      const results = payload.statistics?.results ?? {}

      set_statistics_state({
        running: false,
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
      if (error instanceof Error) {
        push_toast('error', error.message)
      } else {
        push_toast('error', t('glossary_page.feedback.statistics_failed'))
      }
    }
  }, [entries, push_toast, t])

  const open_preset_menu = useCallback(async (): Promise<void> => {
    try {
      const payload = await api_fetch<GlossaryPresetPayload>(
        '/api/quality/rules/presets',
        {
          preset_dir_name: 'glossary',
        },
      )
      set_preset_items([...payload.builtin_presets, ...payload.user_presets])
      set_preset_menu_open(true)
    } catch (error) {
      if (error instanceof Error) {
        push_toast('error', error.message)
      } else {
        push_toast('error', t('glossary_page.feedback.preset_failed'))
      }
    }
  }, [push_toast, t])

  const apply_preset = useCallback(async (virtual_id: string): Promise<void> => {
    try {
      const payload = await api_fetch<{ entries: GlossaryEntry[] }>(
        '/api/quality/rules/presets/read',
        {
          preset_dir_name: 'glossary',
          virtual_id,
        },
      )
      const saved = await save_entries_snapshot(payload.entries)
      if (saved) {
        set_preset_menu_open(false)
      }
    } catch (error) {
      if (error instanceof Error) {
        push_toast('error', error.message)
      } else {
        push_toast('error', t('glossary_page.feedback.preset_failed'))
      }
    }
  }, [push_toast, save_entries_snapshot, t])

  return useMemo<UseGlossaryPageStateResult>(() => {
    return {
      revision,
      enabled,
      entries,
      entry_ids,
      preset_items,
      selected_entry_ids,
      active_entry_id,
      preset_menu_open,
      search_state,
      statistics_state,
      dialog_state,
      update_search_keyword,
      focus_previous_match,
      focus_next_match,
      update_enabled,
      open_create_dialog,
      open_edit_dialog,
      update_dialog_draft,
      import_entries_from_picker,
      export_entries_from_picker,
      run_statistics,
      open_preset_menu,
      apply_preset,
      select_entry,
      select_range,
      box_select_entries,
      delete_selected_entries,
      toggle_case_sensitive_for_selected,
      reorder_selected_entries,
      save_dialog_entry,
      request_close_dialog,
      query_dialog_entry,
      delete_dialog_entry,
      set_preset_menu_open,
      refresh_snapshot,
    }
  }, [
    active_entry_id,
    apply_preset,
    box_select_entries,
    delete_dialog_entry,
    delete_selected_entries,
    dialog_state,
    enabled,
    entries,
    entry_ids,
    export_entries_from_picker,
    focus_next_match,
    focus_previous_match,
    import_entries_from_picker,
    open_create_dialog,
    open_edit_dialog,
    open_preset_menu,
    preset_items,
    preset_menu_open,
    query_dialog_entry,
    refresh_snapshot,
    reorder_selected_entries,
    request_close_dialog,
    revision,
    run_statistics,
    save_dialog_entry,
    search_state,
    select_entry,
    select_range,
    selected_entry_ids,
    statistics_state,
    toggle_case_sensitive_for_selected,
    update_dialog_draft,
    update_enabled,
    update_search_keyword,
  ])
}
