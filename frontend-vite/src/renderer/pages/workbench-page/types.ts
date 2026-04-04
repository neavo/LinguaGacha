import type { LocaleKey } from '@/i18n'

export type WorkbenchActionKind =
  | 'replace-file'
  | 'reset-file'
  | 'delete-file'
  | 'export-translation'
  | 'close-project'

export type WorkbenchTaskStatus = 'IDLE' | 'TRANSLATING' | 'STOPPING' | 'RUN' | 'REQUEST'

export type WorkbenchFileEntry = {
  id: string
  rel_path: string
  original_rel_path: string
  file_type: string
  format_label_key: LocaleKey | null
  format_fallback_label: string | null
  item_count: number
  original_item_count: number
}

export type WorkbenchPendingFile = {
  rel_path: string
  file_type: string
  format_label_key: LocaleKey | null
  format_fallback_label: string | null
  item_count: number
}

export type WorkbenchTaskState = {
  task_type: 'idle' | 'translation'
  status: WorkbenchTaskStatus
  processed_line: number
}

export type WorkbenchSnapshot = {
  file_count: number
  total_items: number
  translated: number
  translated_in_past: number
  file_op_running: boolean
  entries: WorkbenchFileEntry[]
}

export type WorkbenchDialogState = {
  kind: WorkbenchActionKind | null
  target_id: string | null
  pending_file: WorkbenchPendingFile | null
}

export type WorkbenchStats = {
  file_count: number
  total_items: number
  translated: number
  untranslated: number
}

export type WorkbenchMockSeed = {
  supported_extensions: string[]
  project_loaded: boolean
  engine_busy: boolean
  task_snapshot: WorkbenchTaskState
  workbench_snapshot: WorkbenchSnapshot
}
