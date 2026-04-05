import type { LocaleKey } from '@/i18n'

type WorkbenchActionKind =
  | 'replace-file'
  | 'reset-file'
  | 'delete-file'
  | 'export-translation'
  | 'close-project'

export type WorkbenchTaskStatus = string

export type WorkbenchSnapshotEntry = {
  rel_path: string
  file_type: string
  item_count: number
}

export type WorkbenchFileEntry = WorkbenchSnapshotEntry & {
  format_label_key: LocaleKey | null
  format_fallback_label: string | null
}

export type WorkbenchSnapshot = {
  file_count: number
  total_items: number
  translated: number
  translated_in_past: number
  file_op_running: boolean
  entries: WorkbenchSnapshotEntry[]
}

export type WorkbenchDialogState = {
  kind: WorkbenchActionKind | null
  target_rel_path: string | null
  pending_path: string | null
}

export type WorkbenchStats = {
  file_count: number
  total_items: number
  translated: number
  untranslated: number
}
