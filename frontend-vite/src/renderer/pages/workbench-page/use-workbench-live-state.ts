import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useDesktopRuntime } from '@/app/state/use-desktop-runtime'
import { useDesktopToast } from '@/app/state/use-desktop-toast'
import type { LocaleKey } from '@/i18n'
import { useI18n } from '@/i18n'
import { api_fetch } from '@/app/desktop-api'
import type {
  WorkbenchDialogState,
  WorkbenchFileEntry,
  WorkbenchSnapshot,
  WorkbenchSnapshotEntry,
  WorkbenchStats,
  WorkbenchTaskStatus,
} from '@/pages/workbench-page/types'

type WorkbenchSnapshotPayload = {
  snapshot?: Partial<WorkbenchSnapshot> & {
    entries?: Array<Partial<WorkbenchSnapshotEntry>>
  }
}

const ACTIVE_TRANSLATION_STATUSES: ReadonlySet<WorkbenchTaskStatus> = new Set([
  'TRANSLATING',
  'STOPPING',
  'RUN',
  'REQUEST',
])

const EMPTY_SNAPSHOT: WorkbenchSnapshot = {
  file_count: 0,
  total_items: 0,
  translated: 0,
  translated_in_past: 0,
  file_op_running: false,
  entries: [],
}

function normalize_snapshot(payload: WorkbenchSnapshotPayload): WorkbenchSnapshot {
  const snapshot = payload.snapshot ?? {}
  const entries = Array.isArray(snapshot.entries)
    ? snapshot.entries
      .filter((entry) => typeof entry?.rel_path === 'string' && entry.rel_path !== '')
      .map((entry) => ({
        rel_path: String(entry.rel_path),
        file_type: String(entry.file_type ?? ''),
        item_count: Number(entry.item_count ?? 0),
      }))
    : []

  return {
    file_count: Number(snapshot.file_count ?? 0),
    total_items: Number(snapshot.total_items ?? 0),
    translated: Number(snapshot.translated ?? 0),
    translated_in_past: Number(snapshot.translated_in_past ?? 0),
    file_op_running: Boolean(snapshot.file_op_running),
    entries,
  }
}

function close_dialog_state(): WorkbenchDialogState {
  return {
    kind: null,
    target_rel_path: null,
    pending_path: null,
  }
}

function resolve_format_label_key(file_type: string, rel_path: string): LocaleKey | null {
  // 为什么：同一工程在 Qt 与 Vite 两套前端里都要看到同一套格式名称，避免工作台口径漂移。
  if (file_type === 'MD') {
    return 'workbench_page.format.markdown'
  }
  if (file_type === 'RENPY') {
    return 'workbench_page.format.renpy'
  }
  if (file_type === 'KVJSON') {
    return 'workbench_page.format.mtool'
  }
  if (file_type === 'MESSAGEJSON') {
    return 'workbench_page.format.sextractor'
  }
  if (file_type === 'TRANS') {
    return 'workbench_page.format.trans_project'
  }
  if (file_type === 'XLSX') {
    return 'workbench_page.format.translation_export'
  }
  if (file_type === 'WOLFXLSX') {
    return 'workbench_page.format.wolf'
  }
  if (file_type === 'EPUB') {
    return 'workbench_page.format.ebook'
  }

  const lowered_path = rel_path.toLowerCase()
  if (lowered_path.endsWith('.txt')) {
    return 'workbench_page.format.text_file'
  }
  if (lowered_path.endsWith('.srt') || lowered_path.endsWith('.ass')) {
    return 'workbench_page.format.subtitle_file'
  }

  return null
}

function resolve_format_fallback_label(file_type: string, rel_path: string): string | null {
  const format_label_key = resolve_format_label_key(file_type, rel_path)
  if (format_label_key !== null) {
    return null
  }

  const dot_index = rel_path.lastIndexOf('.')
  if (dot_index < 0) {
    return file_type === '' ? '-' : file_type
  }

  return rel_path.slice(dot_index + 1).toUpperCase()
}

function map_snapshot_entries(entries: WorkbenchSnapshotEntry[]): WorkbenchFileEntry[] {
  return entries.map((entry) => ({
    ...entry,
    format_label_key: resolve_format_label_key(entry.file_type, entry.rel_path),
    format_fallback_label: resolve_format_fallback_label(entry.file_type, entry.rel_path),
  }))
}

function build_stats(snapshot: WorkbenchSnapshot, task_type: string, task_status: WorkbenchTaskStatus, processed_line: number): WorkbenchStats {
  const translated = task_type === 'translation' && ACTIVE_TRANSLATION_STATUSES.has(task_status)
    ? Math.min(snapshot.total_items, snapshot.translated_in_past + processed_line)
    : snapshot.translated

  return {
    file_count: snapshot.file_count,
    total_items: snapshot.total_items,
    translated,
    untranslated: Math.max(0, snapshot.total_items - translated),
  }
}

function build_replace_target_rel_path(previous_rel_path: string, next_file_path: string): string {
  const normalized_segments = next_file_path.split(/[\\/]+/u)
  const next_file_name = normalized_segments.at(-1) ?? next_file_path
  const separator_index = Math.max(previous_rel_path.lastIndexOf('/'), previous_rel_path.lastIndexOf('\\'))
  if (separator_index < 0) {
    return next_file_name
  }

  return `${previous_rel_path.slice(0, separator_index + 1)}${next_file_name}`
}

function select_after_snapshot(
  previous_entries: WorkbenchFileEntry[],
  next_entries: WorkbenchFileEntry[],
  selected_rel_path: string | null,
): string | null {
  if (next_entries.length === 0) {
    return null
  }

  if (selected_rel_path !== null && next_entries.some((entry) => entry.rel_path === selected_rel_path)) {
    return selected_rel_path
  }

  if (selected_rel_path !== null) {
    const previous_index = previous_entries.findIndex((entry) => entry.rel_path === selected_rel_path)
    if (previous_index >= 0) {
      const safe_index = Math.min(previous_index, next_entries.length - 1)
      return next_entries[safe_index]?.rel_path ?? null
    }
  }

  return next_entries[0]?.rel_path ?? null
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds)
  })
}

type UseWorkbenchLiveStateResult = {
  stats: WorkbenchStats
  entries: WorkbenchFileEntry[]
  selected_entry_id: string | null
  readonly: boolean
  can_edit_files: boolean
  can_export_translation: boolean
  can_close_project: boolean
  dialog_state: WorkbenchDialogState
  select_entry: (entry_id: string) => void
  request_add_file: () => Promise<void>
  request_export_translation: () => void
  request_close_project: () => void
  request_reset_file: (entry_id: string) => void
  request_delete_file: (entry_id: string) => void
  request_replace_file: (entry_id: string) => Promise<void>
  request_reorder_entries: (ordered_entry_ids: string[]) => Promise<void>
  confirm_dialog: () => Promise<void>
  close_dialog: () => void
}

export function useWorkbenchLiveState(): UseWorkbenchLiveStateResult {
  const { t } = useI18n()
  const { push_toast } = useDesktopToast()
  const {
    project_snapshot,
    refresh_task,
    set_project_snapshot,
    task_snapshot,
  } = useDesktopRuntime()
  const [snapshot, set_snapshot] = useState<WorkbenchSnapshot>(EMPTY_SNAPSHOT)
  const [entries, set_entries] = useState<WorkbenchFileEntry[]>([])
  const [selected_entry_id, set_selected_entry_id] = useState<string | null>(null)
  const [dialog_state, set_dialog_state] = useState<WorkbenchDialogState>(close_dialog_state())
  const [is_mutation_running, set_is_mutation_running] = useState(false)
  const previous_task_status_ref = useRef<WorkbenchTaskStatus>(task_snapshot.status)
  const is_reorder_running_ref = useRef(false)

  const refresh_snapshot = useCallback(async (): Promise<WorkbenchSnapshot> => {
    if (!project_snapshot.loaded) {
      set_snapshot(EMPTY_SNAPSHOT)
      set_entries([])
      set_selected_entry_id(null)
      return EMPTY_SNAPSHOT
    }

    const payload = await api_fetch<WorkbenchSnapshotPayload>('/api/workbench/snapshot', {})
    const next_snapshot = normalize_snapshot(payload)
    set_snapshot(next_snapshot)
    return next_snapshot
  }, [project_snapshot.loaded])

  useEffect(() => {
    let cancelled = false

    async function load_workbench_data(): Promise<void> {
      if (!project_snapshot.loaded) {
        set_snapshot(EMPTY_SNAPSHOT)
        set_entries([])
        set_selected_entry_id(null)
        set_dialog_state(close_dialog_state())
        return
      }

      try {
        const next_snapshot = await refresh_snapshot()
        if (cancelled) {
          return
        }

        const mapped_entries = map_snapshot_entries(next_snapshot.entries)
        set_entries(mapped_entries)
        set_selected_entry_id((previous_entry_id) => select_after_snapshot([], mapped_entries, previous_entry_id))
      } catch {
        if (!cancelled) {
          set_snapshot(EMPTY_SNAPSHOT)
          set_entries([])
          set_selected_entry_id(null)
        }
      }
    }

    void load_workbench_data()

    return () => {
      cancelled = true
    }
  }, [project_snapshot.loaded, refresh_snapshot])

  useEffect(() => {
    const previous_status = previous_task_status_ref.current
    previous_task_status_ref.current = task_snapshot.status

    if (!project_snapshot.loaded) {
      return
    }

    if (previous_status !== task_snapshot.status && previous_status !== 'IDLE' && !task_snapshot.busy) {
      void refresh_snapshot()
    }
  }, [project_snapshot.loaded, refresh_snapshot, task_snapshot.busy, task_snapshot.status])

  useEffect(() => {
    set_selected_entry_id((previous_entry_id) => select_after_snapshot(entries, entries, previous_entry_id))
  }, [entries])

  useEffect(() => {
    if (is_reorder_running_ref.current) {
      return
    }

    set_entries(map_snapshot_entries(snapshot.entries))
  }, [snapshot.entries])

  const stats = useMemo(() => {
    return build_stats(snapshot, task_snapshot.task_type, task_snapshot.status, task_snapshot.processed_line)
  }, [snapshot, task_snapshot.processed_line, task_snapshot.status, task_snapshot.task_type])

  const readonly = !project_snapshot.loaded || task_snapshot.busy || snapshot.file_op_running || is_mutation_running
  const can_edit_files = !readonly
  const can_export_translation = project_snapshot.loaded && !snapshot.file_op_running && !is_mutation_running
  const can_close_project = project_snapshot.loaded && !task_snapshot.busy && !is_mutation_running

  const run_file_mutation = useCallback(async (
    action: () => Promise<void>,
    preferred_rel_path: string | null,
  ): Promise<void> => {
    const previous_entries = entries
    set_is_mutation_running(true)

    try {
      await action()
      let next_snapshot = await refresh_snapshot()

      while (next_snapshot.file_op_running) {
        await delay(500)
        next_snapshot = await refresh_snapshot()
      }

      const next_entries = map_snapshot_entries(next_snapshot.entries)
      set_entries(next_entries)
      set_selected_entry_id(select_after_snapshot(previous_entries, next_entries, preferred_rel_path))
    } catch {
      return
    } finally {
      set_is_mutation_running(false)
    }
  }, [entries, refresh_snapshot])

  function select_entry(entry_id: string): void {
    set_selected_entry_id(entry_id)
  }

  async function request_add_file(): Promise<void> {
    const result = await window.desktopApp.pickWorkbenchFilePath()
    if (result.canceled || result.path === null) {
      return
    }

    const next_selected_rel_path = result.path.split(/[\\/]+/u).at(-1) ?? null
    await run_file_mutation(async () => {
      await api_fetch('/api/workbench/add-file', { path: result.path })
    }, next_selected_rel_path)
  }

  function request_export_translation(): void {
    set_dialog_state({
      kind: 'export-translation',
      target_rel_path: null,
      pending_path: null,
    })
  }

  function request_close_project(): void {
    set_dialog_state({
      kind: 'close-project',
      target_rel_path: null,
      pending_path: null,
    })
  }

  function request_reset_file(entry_id: string): void {
    set_dialog_state({
      kind: 'reset-file',
      target_rel_path: entry_id,
      pending_path: null,
    })
  }

  function request_delete_file(entry_id: string): void {
    set_dialog_state({
      kind: 'delete-file',
      target_rel_path: entry_id,
      pending_path: null,
    })
  }

  async function request_replace_file(entry_id: string): Promise<void> {
    const result = await window.desktopApp.pickWorkbenchFilePath()
    if (result.canceled || result.path === null) {
      return
    }

    set_dialog_state({
      kind: 'replace-file',
      target_rel_path: entry_id,
      pending_path: result.path,
    })
  }

  const request_reorder_entries = useCallback(async (ordered_entry_ids: string[]): Promise<void> => {
    if (readonly) {
      return
    }

    if (ordered_entry_ids.length !== entries.length) {
      return
    }
    if (new Set(ordered_entry_ids).size !== ordered_entry_ids.length) {
      return
    }

    const entry_map = new Map(entries.map((entry) => [entry.rel_path, entry]))
    const next_entries: WorkbenchFileEntry[] = []
    for (const entry_id of ordered_entry_ids) {
      const entry = entry_map.get(entry_id)
      if (entry === undefined) {
        return
      }
      next_entries.push(entry)
    }

    if (next_entries.length !== entries.length) {
      return
    }

    const previous_entries = entries
    is_reorder_running_ref.current = true
    set_is_mutation_running(true)
    set_entries(next_entries)

    try {
      await api_fetch('/api/workbench/reorder-files', {
        ordered_rel_paths: ordered_entry_ids,
      })

      try {
        const next_snapshot = await refresh_snapshot()
        set_entries(map_snapshot_entries(next_snapshot.entries))
      } catch {
        set_entries(next_entries)
      }
    } catch {
      set_entries(previous_entries)
      push_toast('error', t('workbench_page.reorder.failed'))
    } finally {
      is_reorder_running_ref.current = false
      set_is_mutation_running(false)
    }
  }, [entries, push_toast, readonly, refresh_snapshot, t])

  async function confirm_dialog(): Promise<void> {
    const current_dialog_state = dialog_state
    set_dialog_state(close_dialog_state())

    if (current_dialog_state.kind === 'replace-file') {
      if (current_dialog_state.target_rel_path === null || current_dialog_state.pending_path === null) {
        return
      }

      await run_file_mutation(async () => {
        await api_fetch('/api/workbench/replace-file', {
          rel_path: current_dialog_state.target_rel_path,
          path: current_dialog_state.pending_path,
        })
      }, build_replace_target_rel_path(current_dialog_state.target_rel_path, current_dialog_state.pending_path))
      return
    }

    if (current_dialog_state.kind === 'reset-file' && current_dialog_state.target_rel_path !== null) {
      await run_file_mutation(async () => {
        await api_fetch('/api/workbench/reset-file', {
          rel_path: current_dialog_state.target_rel_path,
        })
      }, current_dialog_state.target_rel_path)
      return
    }

    if (current_dialog_state.kind === 'delete-file' && current_dialog_state.target_rel_path !== null) {
      await run_file_mutation(async () => {
        await api_fetch('/api/workbench/delete-file', {
          rel_path: current_dialog_state.target_rel_path,
        })
      }, selected_entry_id === current_dialog_state.target_rel_path ? null : selected_entry_id)
      return
    }

    if (current_dialog_state.kind === 'export-translation') {
      try {
        await api_fetch('/api/tasks/export-translation', {})
      } catch {
        return
      }
      return
    }

    if (current_dialog_state.kind === 'close-project') {
      set_is_mutation_running(true)
      try {
        const payload = await api_fetch<{ project?: { path?: string; loaded?: boolean } }>('/api/project/unload', {})
        set_project_snapshot({
          path: String(payload.project?.path ?? ''),
          loaded: Boolean(payload.project?.loaded),
        })
        set_snapshot(EMPTY_SNAPSHOT)
        set_entries([])
        set_selected_entry_id(null)
        await refresh_task()
      } catch {
        return
      } finally {
        set_is_mutation_running(false)
      }
    }
  }

  function close_dialog(): void {
    set_dialog_state(close_dialog_state())
  }

  return {
    stats,
    entries,
    selected_entry_id,
    readonly,
    can_edit_files,
    can_export_translation,
    can_close_project,
    dialog_state,
    select_entry,
    request_add_file,
    request_export_translation,
    request_close_project,
    request_reset_file,
    request_delete_file,
    request_replace_file,
    request_reorder_entries,
    confirm_dialog,
    close_dialog,
  }
}

