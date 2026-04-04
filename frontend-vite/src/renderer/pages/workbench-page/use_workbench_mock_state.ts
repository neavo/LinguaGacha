import { useReducer } from 'react'

import { workbench_page_mock } from '@/pages/workbench-page/mock'
import type {
  WorkbenchActionKind,
  WorkbenchDialogState,
  WorkbenchFileEntry,
  WorkbenchPendingFile,
  WorkbenchSnapshot,
  WorkbenchStats,
  WorkbenchTaskState,
} from '@/pages/workbench-page/types'

type WorkbenchState = {
  entries: WorkbenchFileEntry[]
  original_entries_by_id: Record<string, WorkbenchFileEntry>
  selected_entry_id: string | null
  project_loaded: boolean
  engine_busy: boolean
  file_op_running: boolean
  task_snapshot: WorkbenchTaskState
  dialog_state: WorkbenchDialogState
}

type WorkbenchAction =
  | { type: 'select-entry'; entry_id: string | null }
  | { type: 'open-dialog'; kind: WorkbenchActionKind; target_id?: string | null; pending_file?: WorkbenchPendingFile | null }
  | { type: 'close-dialog' }
  | { type: 'add-file'; pending_file: WorkbenchPendingFile }
  | { type: 'confirm-dialog' }

const TRANSLATING_STATUSES: ReadonlySet<WorkbenchTaskState['status']> = new Set([
  'TRANSLATING',
  'STOPPING',
  'RUN',
  'REQUEST',
])

function clone_entry(entry: WorkbenchFileEntry): WorkbenchFileEntry {
  return { ...entry }
}

function build_original_entry_map(entries: WorkbenchFileEntry[]): Record<string, WorkbenchFileEntry> {
  return Object.fromEntries(entries.map((entry) => [entry.id, clone_entry(entry)]))
}

function create_initial_state(): WorkbenchState {
  const initial_entries = workbench_page_mock.workbench_snapshot.entries.map(clone_entry)

  return {
    entries: initial_entries,
    original_entries_by_id: build_original_entry_map(initial_entries),
    selected_entry_id: initial_entries[0]?.id ?? null,
    project_loaded: workbench_page_mock.project_loaded,
    engine_busy: workbench_page_mock.engine_busy,
    file_op_running: workbench_page_mock.workbench_snapshot.file_op_running,
    task_snapshot: { ...workbench_page_mock.task_snapshot },
    dialog_state: {
      kind: null,
      target_id: null,
      pending_file: null,
    },
  }
}

function build_snapshot(state: WorkbenchState): WorkbenchSnapshot {
  const total_items = state.entries.reduce((sum, entry) => sum + entry.item_count, 0)

  return {
    file_count: state.entries.length,
    total_items,
    translated: 0,
    translated_in_past: 0,
    file_op_running: state.file_op_running,
    entries: state.entries,
  }
}

function build_stats(snapshot: WorkbenchSnapshot, task_snapshot: WorkbenchTaskState): WorkbenchStats {
  const translated_count = TRANSLATING_STATUSES.has(task_snapshot.status) && task_snapshot.task_type === 'translation'
    ? Math.min(snapshot.total_items, snapshot.translated_in_past + task_snapshot.processed_line)
    : snapshot.translated

  return {
    file_count: snapshot.file_count,
    total_items: snapshot.total_items,
    translated: translated_count,
    untranslated: Math.max(0, snapshot.total_items - translated_count),
  }
}

function select_after_removal(
  previous_entries: WorkbenchFileEntry[],
  next_entries: WorkbenchFileEntry[],
  removed_entry_id: string,
  previous_selected_id: string | null,
): string | null {
  if (next_entries.length === 0) {
    return null
  }

  if (previous_selected_id !== removed_entry_id) {
    const existing_selected_entry = next_entries.find((entry) => entry.id === previous_selected_id)
    if (existing_selected_entry !== undefined) {
      return existing_selected_entry.id
    }
  }

  const removed_index = previous_entries.findIndex((entry) => entry.id === removed_entry_id)
  const safe_index = removed_index >= 0 ? Math.min(removed_index, next_entries.length - 1) : 0
  return next_entries[safe_index]?.id ?? null
}

function close_dialog_state(): WorkbenchDialogState {
  return {
    kind: null,
    target_id: null,
    pending_file: null,
  }
}

function create_entry_id(file_name: string): string {
  const safe_file_name = file_name.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()
  return `${safe_file_name || 'file'}-${Date.now().toString(36)}`
}

function create_entry_from_pending_file(pending_file: WorkbenchPendingFile): WorkbenchFileEntry {
  return {
    id: create_entry_id(pending_file.rel_path),
    rel_path: pending_file.rel_path,
    original_rel_path: pending_file.rel_path,
    file_type: pending_file.file_type,
    format_label_key: pending_file.format_label_key,
    format_fallback_label: pending_file.format_fallback_label,
    item_count: pending_file.item_count,
    original_item_count: pending_file.item_count,
  }
}

function replace_entry_with_pending_file(
  entry: WorkbenchFileEntry,
  pending_file: WorkbenchPendingFile,
): WorkbenchFileEntry {
  return {
    ...entry,
    rel_path: pending_file.rel_path,
    original_rel_path: pending_file.rel_path,
    file_type: pending_file.file_type,
    format_label_key: pending_file.format_label_key,
    format_fallback_label: pending_file.format_fallback_label,
    item_count: pending_file.item_count,
    original_item_count: pending_file.item_count,
  }
}

function apply_replace_file(state: WorkbenchState, dialog_state: WorkbenchDialogState): WorkbenchState {
  if (dialog_state.target_id === null || dialog_state.pending_file === null) {
    return {
      ...state,
      dialog_state: close_dialog_state(),
    }
  }

  const target_id = dialog_state.target_id
  const pending_file = dialog_state.pending_file
  const updated_entries = state.entries.map((entry) => {
    if (entry.id === target_id) {
      return replace_entry_with_pending_file(entry, pending_file)
    } else {
      return entry
    }
  })
  const updated_original_entry = updated_entries.find((entry) => entry.id === target_id)

  return {
    ...state,
    entries: updated_entries,
    original_entries_by_id: updated_original_entry === undefined
      ? state.original_entries_by_id
      : {
          ...state.original_entries_by_id,
          [target_id]: clone_entry(updated_original_entry),
        },
    selected_entry_id: target_id,
    dialog_state: close_dialog_state(),
  }
}

function apply_reset_file(state: WorkbenchState, dialog_state: WorkbenchDialogState): WorkbenchState {
  if (dialog_state.target_id === null) {
    return {
      ...state,
      dialog_state: close_dialog_state(),
    }
  }

  const original_entry = state.original_entries_by_id[dialog_state.target_id]
  const updated_entries = state.entries.map((entry) => {
    if (entry.id === dialog_state.target_id && original_entry !== undefined) {
      return clone_entry(original_entry)
    } else {
      return entry
    }
  })

  return {
    ...state,
    entries: updated_entries,
    selected_entry_id: dialog_state.target_id,
    dialog_state: close_dialog_state(),
  }
}

function apply_delete_file(state: WorkbenchState, dialog_state: WorkbenchDialogState): WorkbenchState {
  if (dialog_state.target_id === null) {
    return {
      ...state,
      dialog_state: close_dialog_state(),
    }
  }

  const updated_entries = state.entries.filter((entry) => entry.id !== dialog_state.target_id)
  const next_original_entries = { ...state.original_entries_by_id }
  delete next_original_entries[dialog_state.target_id]

  return {
    ...state,
    entries: updated_entries,
    original_entries_by_id: next_original_entries,
    selected_entry_id: select_after_removal(
      state.entries,
      updated_entries,
      dialog_state.target_id,
      state.selected_entry_id,
    ),
    dialog_state: close_dialog_state(),
  }
}

function apply_confirm_dialog(state: WorkbenchState): WorkbenchState {
  const dialog_state = state.dialog_state

  if (dialog_state.kind === 'replace-file') {
    return apply_replace_file(state, dialog_state)
  } else if (dialog_state.kind === 'reset-file') {
    return apply_reset_file(state, dialog_state)
  } else if (dialog_state.kind === 'delete-file') {
    return apply_delete_file(state, dialog_state)
  } else if (dialog_state.kind === 'close-project') {
    return {
      ...state,
      entries: [],
      selected_entry_id: null,
      project_loaded: false,
      file_op_running: false,
      dialog_state: close_dialog_state(),
    }
  } else {
    return {
      ...state,
      dialog_state: close_dialog_state(),
    }
  }
}

function workbench_reducer(state: WorkbenchState, action: WorkbenchAction): WorkbenchState {
  if (action.type === 'select-entry') {
    return {
      ...state,
      selected_entry_id: action.entry_id,
    }
  } else if (action.type === 'open-dialog') {
    return {
      ...state,
      dialog_state: {
        kind: action.kind,
        target_id: action.target_id ?? null,
        pending_file: action.pending_file ?? null,
      },
    }
  } else if (action.type === 'close-dialog') {
    return {
      ...state,
      dialog_state: close_dialog_state(),
    }
  } else if (action.type === 'add-file') {
    const new_entry = create_entry_from_pending_file(action.pending_file)

    return {
      ...state,
      entries: [...state.entries, new_entry],
      original_entries_by_id: {
        ...state.original_entries_by_id,
        [new_entry.id]: clone_entry(new_entry),
      },
      selected_entry_id: new_entry.id,
    }
  } else {
    return apply_confirm_dialog(state)
  }
}

function resolve_file_meta(file_name: string): Pick<WorkbenchPendingFile, 'file_type' | 'format_label_key' | 'format_fallback_label'> {
  const normalized_file_name = file_name.toLowerCase()

  if (normalized_file_name.endsWith('.md')) {
    return { file_type: 'MD', format_label_key: 'task.page.workbench.format.markdown', format_fallback_label: null }
  } else if (normalized_file_name.endsWith('.txt')) {
    return { file_type: 'TXT', format_label_key: 'task.page.workbench.format.text_file', format_fallback_label: null }
  } else if (normalized_file_name.endsWith('.srt') || normalized_file_name.endsWith('.ass')) {
    return { file_type: 'SUBTITLE', format_label_key: 'task.page.workbench.format.subtitle_file', format_fallback_label: null }
  } else if (normalized_file_name.endsWith('.epub')) {
    return { file_type: 'EPUB', format_label_key: 'task.page.workbench.format.ebook', format_fallback_label: null }
  } else if (normalized_file_name.endsWith('.xlsx')) {
    return { file_type: 'XLSX', format_label_key: 'task.page.workbench.format.translation_export', format_fallback_label: null }
  } else {
    const extension = file_name.split('.').pop()
    return {
      file_type: extension?.toUpperCase() ?? 'FILE',
      format_label_key: null,
      format_fallback_label: extension?.toUpperCase() ?? '-',
    }
  }
}

function create_pending_file(file: File): WorkbenchPendingFile {
  const file_meta = resolve_file_meta(file.name)
  const synthesized_line_count = Math.max(12, Math.min(240, file.name.length * 3))

  return {
    rel_path: file.name,
    file_type: file_meta.file_type,
    format_label_key: file_meta.format_label_key,
    format_fallback_label: file_meta.format_fallback_label,
    item_count: synthesized_line_count,
  }
}

type UseWorkbenchMockStateResult = {
  snapshot: WorkbenchSnapshot
  stats: WorkbenchStats
  entries: WorkbenchFileEntry[]
  selected_entry_id: string | null
  selected_entry: WorkbenchFileEntry | null
  project_loaded: boolean
  readonly: boolean
  can_edit_files: boolean
  can_export_translation: boolean
  can_close_project: boolean
  dialog_state: WorkbenchDialogState
  supported_extensions: string[]
  select_entry: (entry_id: string) => void
  request_export_translation: () => void
  request_close_project: () => void
  request_reset_file: (entry_id: string) => void
  request_delete_file: (entry_id: string) => void
  request_replace_file: (entry_id: string, file: File) => void
  add_file: (file: File) => void
  confirm_dialog: () => void
  close_dialog: () => void
}

export function useWorkbenchMockState(): UseWorkbenchMockStateResult {
  const [state, dispatch] = useReducer(workbench_reducer, undefined, create_initial_state)
  const snapshot = build_snapshot(state)
  const stats = build_stats(snapshot, state.task_snapshot)
  const readonly = !state.project_loaded || state.engine_busy || state.file_op_running
  const selected_entry = state.entries.find((entry) => entry.id === state.selected_entry_id) ?? null

  // 所有可操作性判断都统一收口在 hook 内，避免页面和组件各自复制桌面版规则。
  const can_edit_files = !readonly
  const can_export_translation = state.project_loaded && !state.file_op_running
  const can_close_project = state.project_loaded && !state.engine_busy

  function select_entry(entry_id: string): void {
    dispatch({ type: 'select-entry', entry_id })
  }

  function open_dialog(
    kind: WorkbenchActionKind,
    target_id?: string | null,
    pending_file?: WorkbenchPendingFile | null,
  ): void {
    dispatch({ type: 'open-dialog', kind, target_id, pending_file })
  }

  function request_export_translation(): void {
    open_dialog('export-translation')
  }

  function request_close_project(): void {
    open_dialog('close-project')
  }

  function request_reset_file(entry_id: string): void {
    open_dialog('reset-file', entry_id)
  }

  function request_delete_file(entry_id: string): void {
    open_dialog('delete-file', entry_id)
  }

  function request_replace_file(entry_id: string, file: File): void {
    open_dialog('replace-file', entry_id, create_pending_file(file))
  }

  function add_file(file: File): void {
    dispatch({ type: 'add-file', pending_file: create_pending_file(file) })
  }

  function confirm_dialog(): void {
    dispatch({ type: 'confirm-dialog' })
  }

  function close_dialog(): void {
    dispatch({ type: 'close-dialog' })
  }

  return {
    snapshot,
    stats,
    entries: state.entries,
    selected_entry_id: state.selected_entry_id,
    selected_entry,
    project_loaded: state.project_loaded,
    readonly,
    can_edit_files,
    can_export_translation,
    can_close_project,
    dialog_state: state.dialog_state,
    supported_extensions: workbench_page_mock.supported_extensions,
    select_entry,
    request_export_translation,
    request_close_project,
    request_reset_file,
    request_delete_file,
    request_replace_file,
    add_file,
    confirm_dialog,
    close_dialog,
  }
}
