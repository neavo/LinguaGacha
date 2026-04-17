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
  error_count: number
  file_op_running: boolean
  entries: WorkbenchSnapshotEntry[]
}

export type WorkbenchDialogState = {
  kind: WorkbenchActionKind | null
  target_rel_path: string | null
  pending_path: string | null
}

export type WorkbenchTaskKind = 'translation' | 'analysis'

export type WorkbenchTaskViewState = {
  task_kind: WorkbenchTaskKind | null
  can_open_detail: boolean
}

export type WorkbenchTaskTone = 'neutral' | 'success' | 'warning'

export type WorkbenchTaskMetricEntry = {
  key: string
  label: string
  value_text: string
  unit_text: string
}

export type WorkbenchTaskSummaryViewModel = {
  status_text: string
  trailing_text: string | null
  tone: WorkbenchTaskTone
  show_spinner: boolean
  detail_tooltip_text: string
}

export type WorkbenchTaskDetailViewModel = {
  title: string
  description: string
  waveform_title: string
  metrics_title: string
  completion_percent_text: string
  percent_tone: WorkbenchTaskTone
  metric_entries: WorkbenchTaskMetricEntry[]
  stop_button_label: string
  stop_disabled: boolean
  waveform_history: number[]
}

export type WorkbenchTaskConfirmDialogViewModel = {
  open: boolean
  title: string
  description: string
  confirm_label: string
  cancel_label: string
  submitting: boolean
}

export type WorkbenchStats = {
  total_items: number
  translated: number
  error_count: number
  untranslated: number
}
