/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import type { RouteId } from '@/app/navigation/types'
import { api_fetch, open_event_stream } from '@/app/desktop-api'

type RecentProjectEntry = {
  path: string
  name: string
}

export type AppLanguage = 'ZH' | 'EN'

export type SettingsSnapshot = {
  app_language: AppLanguage
  source_language: string
  target_language: string
  project_save_mode: string
  project_fixed_path: string
  output_folder_open_on_finish: boolean
  request_timeout: number
  preceding_lines_threshold: number
  clean_ruby: boolean
  deduplication_in_trans: boolean
  deduplication_in_bilingual: boolean
  check_kana_residue: boolean
  check_hangeul_residue: boolean
  check_similarity: boolean
  write_translated_name_fields_to_file: boolean
  auto_process_prefix_suffix_preserved_text: boolean
  mtool_optimizer_enable: boolean
  recent_projects: RecentProjectEntry[]
}

export type ProjectSnapshot = {
  path: string
  loaded: boolean
}

type TaskSnapshot = {
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
  analysis_candidate_count: number
}

export type ProofreadingChangeScope = 'global' | 'file' | 'entry'
export type WorkbenchChangeScope = 'global' | 'file' | 'order'

export type ProofreadingChangeSignal = {
  seq: number
  reason: string
  scope: ProofreadingChangeScope
  item_ids: number[]
  rel_paths: string[]
  removed_rel_paths: string[]
}

export type WorkbenchChangeSignal = {
  seq: number
  reason: string
  scope: WorkbenchChangeScope
  rel_paths: string[]
  removed_rel_paths: string[]
  order_changed: boolean
}

export type ProjectWarmupStatus = 'idle' | 'warming' | 'ready'

type DesktopRuntimeContextValue = {
  hydration_ready: boolean
  hydration_error: string | null
  settings_snapshot: SettingsSnapshot
  project_snapshot: ProjectSnapshot
  task_snapshot: TaskSnapshot
  proofreading_change_signal: ProofreadingChangeSignal
  workbench_change_signal: WorkbenchChangeSignal
  project_warmup_status: ProjectWarmupStatus
  pending_target_route: RouteId | null
  is_app_language_updating: boolean
  set_settings_snapshot: (snapshot: SettingsSnapshot) => void
  set_project_snapshot: (snapshot: ProjectSnapshot) => void
  set_task_snapshot: (snapshot: TaskSnapshot) => void
  set_project_warmup_status: (status: ProjectWarmupStatus) => void
  set_pending_target_route: (route_id: RouteId | null) => void
  wait_for_project_warmup: (project_path: string) => Promise<void>
  update_app_language: (language: AppLanguage) => Promise<SettingsSnapshot>
  refresh_settings: () => Promise<SettingsSnapshot>
  refresh_project: () => Promise<ProjectSnapshot>
  refresh_task: () => Promise<TaskSnapshot>
}

export type SettingsSnapshotPayload = {
  settings?: Partial<SettingsSnapshot> & {
    recent_projects?: Array<Partial<RecentProjectEntry>>
  }
}

type ProjectSnapshotPayload = {
  project?: Partial<ProjectSnapshot>
}

type TaskSnapshotPayload = {
  task?: Partial<TaskSnapshot>
}

type SettingsChangedEventPayload = {
  keys?: unknown
  settings?: Partial<SettingsSnapshot> & {
    recent_projects?: Array<Partial<RecentProjectEntry>>
  }
}

type ProofreadingSnapshotInvalidatedEventPayload = {
  reason?: unknown
  scope?: unknown
  item_ids?: unknown
  rel_paths?: unknown
  removed_rel_paths?: unknown
}

type WorkbenchSnapshotChangedEventPayload = {
  reason?: unknown
  scope?: unknown
  rel_paths?: unknown
  removed_rel_paths?: unknown
  order_changed?: unknown
}

const DEFAULT_SETTINGS_SNAPSHOT: SettingsSnapshot = {
  app_language: 'ZH',
  source_language: 'JA',
  target_language: 'ZH',
  project_save_mode: 'MANUAL',
  project_fixed_path: '',
  output_folder_open_on_finish: true,
  request_timeout: 60,
  preceding_lines_threshold: 0,
  clean_ruby: false,
  deduplication_in_trans: true,
  deduplication_in_bilingual: true,
  check_kana_residue: true,
  check_hangeul_residue: true,
  check_similarity: true,
  write_translated_name_fields_to_file: true,
  auto_process_prefix_suffix_preserved_text: true,
  mtool_optimizer_enable: true,
  recent_projects: [],
}

const DEFAULT_PROJECT_SNAPSHOT: ProjectSnapshot = {
  path: '',
  loaded: false,
}

const DEFAULT_TASK_SNAPSHOT: TaskSnapshot = {
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
  analysis_candidate_count: 0,
}

const DEFAULT_PROOFREADING_CHANGE_SIGNAL: ProofreadingChangeSignal = {
  seq: 0,
  reason: '',
  scope: 'global',
  item_ids: [],
  rel_paths: [],
  removed_rel_paths: [],
}

const DEFAULT_WORKBENCH_CHANGE_SIGNAL: WorkbenchChangeSignal = {
  seq: 0,
  reason: '',
  scope: 'global',
  rel_paths: [],
  removed_rel_paths: [],
  order_changed: false,
}

export const DesktopRuntimeContext = createContext<DesktopRuntimeContextValue | null>(null)

function normalize_app_language(app_language: unknown): AppLanguage {
  if (String(app_language ?? '').trim().toUpperCase() === 'EN') {
    return 'EN'
  }

  return 'ZH'
}

function normalize_recent_projects(
  recent_projects: Array<Partial<RecentProjectEntry>> | undefined,
): RecentProjectEntry[] {
  if (!Array.isArray(recent_projects)) {
    return []
  }

  return recent_projects
    .filter((entry) => typeof entry?.path === 'string' && entry.path !== '')
    .map((entry) => ({
      path: String(entry.path),
      name: String(entry.name ?? ''),
    }))
}

export function normalize_settings_snapshot(payload: SettingsSnapshotPayload): SettingsSnapshot {
  const snapshot = payload.settings ?? {}
  return {
    app_language: normalize_app_language(snapshot.app_language),
    source_language: String(snapshot.source_language ?? DEFAULT_SETTINGS_SNAPSHOT.source_language),
    target_language: String(snapshot.target_language ?? DEFAULT_SETTINGS_SNAPSHOT.target_language),
    project_save_mode: String(snapshot.project_save_mode ?? DEFAULT_SETTINGS_SNAPSHOT.project_save_mode),
    project_fixed_path: String(snapshot.project_fixed_path ?? ''),
    output_folder_open_on_finish: Boolean(
      snapshot.output_folder_open_on_finish ?? DEFAULT_SETTINGS_SNAPSHOT.output_folder_open_on_finish,
    ),
    request_timeout: Number(snapshot.request_timeout ?? DEFAULT_SETTINGS_SNAPSHOT.request_timeout),
    preceding_lines_threshold: Number(
      snapshot.preceding_lines_threshold ?? DEFAULT_SETTINGS_SNAPSHOT.preceding_lines_threshold,
    ),
    clean_ruby: Boolean(snapshot.clean_ruby ?? DEFAULT_SETTINGS_SNAPSHOT.clean_ruby),
    deduplication_in_trans: Boolean(
      snapshot.deduplication_in_trans ?? DEFAULT_SETTINGS_SNAPSHOT.deduplication_in_trans,
    ),
    deduplication_in_bilingual: Boolean(
      snapshot.deduplication_in_bilingual ?? DEFAULT_SETTINGS_SNAPSHOT.deduplication_in_bilingual,
    ),
    check_kana_residue: Boolean(
      snapshot.check_kana_residue ?? DEFAULT_SETTINGS_SNAPSHOT.check_kana_residue,
    ),
    check_hangeul_residue: Boolean(
      snapshot.check_hangeul_residue ?? DEFAULT_SETTINGS_SNAPSHOT.check_hangeul_residue,
    ),
    check_similarity: Boolean(snapshot.check_similarity ?? DEFAULT_SETTINGS_SNAPSHOT.check_similarity),
    write_translated_name_fields_to_file: Boolean(
      snapshot.write_translated_name_fields_to_file
      ?? DEFAULT_SETTINGS_SNAPSHOT.write_translated_name_fields_to_file,
    ),
    auto_process_prefix_suffix_preserved_text: Boolean(
      snapshot.auto_process_prefix_suffix_preserved_text
      ?? DEFAULT_SETTINGS_SNAPSHOT.auto_process_prefix_suffix_preserved_text,
    ),
    mtool_optimizer_enable: Boolean(
      snapshot.mtool_optimizer_enable ?? DEFAULT_SETTINGS_SNAPSHOT.mtool_optimizer_enable,
    ),
    recent_projects: normalize_recent_projects(snapshot.recent_projects),
  }
}

function normalize_project_snapshot(payload: ProjectSnapshotPayload): ProjectSnapshot {
  const snapshot = payload.project ?? {}
  return {
    path: String(snapshot.path ?? ''),
    loaded: Boolean(snapshot.loaded),
  }
}

function normalize_task_snapshot(payload: TaskSnapshotPayload): TaskSnapshot {
  const snapshot = payload.task ?? {}
  return {
    task_type: String(snapshot.task_type ?? DEFAULT_TASK_SNAPSHOT.task_type),
    status: String(snapshot.status ?? DEFAULT_TASK_SNAPSHOT.status),
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
    analysis_candidate_count: Number(snapshot.analysis_candidate_count ?? 0),
  }
}

function merge_task_status_update(previous_snapshot: TaskSnapshot, payload: Partial<TaskSnapshot>): TaskSnapshot {
  return {
    ...previous_snapshot,
    task_type: payload.task_type === undefined ? previous_snapshot.task_type : String(payload.task_type),
    status: payload.status === undefined ? previous_snapshot.status : String(payload.status),
    busy: payload.busy === undefined ? previous_snapshot.busy : Boolean(payload.busy),
  }
}

function merge_task_progress_update(previous_snapshot: TaskSnapshot, payload: Partial<TaskSnapshot>): TaskSnapshot {
  return {
    ...previous_snapshot,
    task_type: payload.task_type === undefined ? previous_snapshot.task_type : String(payload.task_type),
    request_in_flight_count: payload.request_in_flight_count === undefined
      ? previous_snapshot.request_in_flight_count
      : Number(payload.request_in_flight_count),
    line: payload.line === undefined ? previous_snapshot.line : Number(payload.line),
    total_line: payload.total_line === undefined ? previous_snapshot.total_line : Number(payload.total_line),
    processed_line: payload.processed_line === undefined ? previous_snapshot.processed_line : Number(payload.processed_line),
    error_line: payload.error_line === undefined ? previous_snapshot.error_line : Number(payload.error_line),
    total_tokens: payload.total_tokens === undefined ? previous_snapshot.total_tokens : Number(payload.total_tokens),
    total_output_tokens: payload.total_output_tokens === undefined
      ? previous_snapshot.total_output_tokens
      : Number(payload.total_output_tokens),
    total_input_tokens: payload.total_input_tokens === undefined
      ? previous_snapshot.total_input_tokens
      : Number(payload.total_input_tokens),
    time: payload.time === undefined ? previous_snapshot.time : Number(payload.time),
    start_time: payload.start_time === undefined ? previous_snapshot.start_time : Number(payload.start_time),
    analysis_candidate_count: payload.analysis_candidate_count === undefined
      ? previous_snapshot.analysis_candidate_count
      : Number(payload.analysis_candidate_count),
  }
}

function parse_event_payload(event: MessageEvent<string>): Record<string, unknown> {
  try {
    return JSON.parse(event.data) as Record<string, unknown>
  } catch {
    return {}
  }
}

function normalize_string_array(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((entry) => String(entry ?? '').trim())
    .filter((entry) => entry !== '')
}

function normalize_item_id_array(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return []
  }

  const item_ids: number[] = []
  for (const entry of value) {
    const next_item_id = Number(entry)
    if (!Number.isInteger(next_item_id)) {
      continue
    }
    if (!item_ids.includes(next_item_id)) {
      item_ids.push(next_item_id)
    }
  }
  return item_ids
}

function normalize_proofreading_change_scope(value: unknown): ProofreadingChangeScope {
  if (value === 'file' || value === 'entry') {
    return value
  }

  return 'global'
}

function normalize_workbench_change_scope(value: unknown): WorkbenchChangeScope {
  if (value === 'file' || value === 'order') {
    return value
  }

  return 'global'
}

export function DesktopRuntimeProvider(props: { children: ReactNode }): JSX.Element {
  const [hydration_ready, set_hydration_ready] = useState(false)
  const [hydration_error, set_hydration_error] = useState<string | null>(null)
  const [settings_snapshot, set_settings_snapshot] = useState<SettingsSnapshot>(DEFAULT_SETTINGS_SNAPSHOT)
  const [project_snapshot, set_project_snapshot] = useState<ProjectSnapshot>(DEFAULT_PROJECT_SNAPSHOT)
  const [task_snapshot, set_task_snapshot] = useState<TaskSnapshot>(DEFAULT_TASK_SNAPSHOT)
  const [proofreading_change_signal, set_proofreading_change_signal] = useState<ProofreadingChangeSignal>(
    DEFAULT_PROOFREADING_CHANGE_SIGNAL,
  )
  const [workbench_change_signal, set_workbench_change_signal] = useState<WorkbenchChangeSignal>(
    DEFAULT_WORKBENCH_CHANGE_SIGNAL,
  )
  const [project_warmup_status, set_project_warmup_status] = useState<ProjectWarmupStatus>('idle')
  const [pending_target_route, set_pending_target_route] = useState<RouteId | null>(null)
  const [is_app_language_updating, set_is_app_language_updating] = useState(false)
  const project_warmup_waiters_ref = useRef<Map<string, Set<() => void>>>(new Map())

  const apply_settings_snapshot = useCallback((payload: SettingsSnapshotPayload): SettingsSnapshot => {
    const next_snapshot = normalize_settings_snapshot(payload)
    set_settings_snapshot(next_snapshot)
    return next_snapshot
  }, [])

  const refresh_settings = useCallback(async (): Promise<SettingsSnapshot> => {
    const payload = await api_fetch<SettingsSnapshotPayload>('/api/settings/app', {})
    return apply_settings_snapshot(payload)
  }, [apply_settings_snapshot])

  const refresh_project = useCallback(async (): Promise<ProjectSnapshot> => {
    const payload = await api_fetch<ProjectSnapshotPayload>('/api/project/snapshot', {})
    const next_snapshot = normalize_project_snapshot(payload)
    set_project_snapshot(next_snapshot)
    return next_snapshot
  }, [])

  const refresh_task = useCallback(async (): Promise<TaskSnapshot> => {
    const payload = await api_fetch<TaskSnapshotPayload>('/api/tasks/snapshot', {})
    const next_snapshot = normalize_task_snapshot(payload)
    set_task_snapshot(next_snapshot)
    return next_snapshot
  }, [])

  const update_app_language = useCallback(async (language: AppLanguage): Promise<SettingsSnapshot> => {
    if (is_app_language_updating || settings_snapshot.app_language === language) {
      return settings_snapshot
    }

    set_is_app_language_updating(true)
    try {
      const payload = await api_fetch<SettingsSnapshotPayload>('/api/settings/update', {
        app_language: language,
      })
      return apply_settings_snapshot(payload)
    } finally {
      set_is_app_language_updating(false)
    }
  }, [
    apply_settings_snapshot,
    is_app_language_updating,
    settings_snapshot,
  ])

  const resolve_project_warmup_waiters = useCallback((project_path: string): void => {
    const normalized_project_path = project_path.trim()
    if (normalized_project_path === '') {
      return
    }

    const waiters = project_warmup_waiters_ref.current.get(normalized_project_path)
    if (waiters === undefined) {
      return
    }

    project_warmup_waiters_ref.current.delete(normalized_project_path)
    for (const resolve of waiters) {
      resolve()
    }
  }, [])

  const resolve_all_project_warmup_waiters = useCallback((): void => {
    for (const waiters of project_warmup_waiters_ref.current.values()) {
      for (const resolve of waiters) {
        resolve()
      }
    }
    project_warmup_waiters_ref.current.clear()
  }, [])

  const wait_for_project_warmup = useCallback((project_path: string): Promise<void> => {
    const normalized_project_path = project_path.trim()
    if (normalized_project_path === '') {
      return Promise.resolve()
    }

    if (
      project_snapshot.loaded
      && project_snapshot.path === normalized_project_path
      && project_warmup_status === 'ready'
    ) {
      return Promise.resolve()
    }

    return new Promise((resolve) => {
      const waiters = project_warmup_waiters_ref.current.get(normalized_project_path) ?? new Set()
      waiters.add(resolve)
      project_warmup_waiters_ref.current.set(normalized_project_path, waiters)
    })
  }, [
    project_snapshot.loaded,
    project_snapshot.path,
    project_warmup_status,
  ])

  useEffect(() => {
    if (!project_snapshot.loaded) {
      resolve_all_project_warmup_waiters()
      return
    }

    if (project_warmup_status === 'ready') {
      resolve_project_warmup_waiters(project_snapshot.path)
    }
  }, [
    project_snapshot.loaded,
    project_snapshot.path,
    project_warmup_status,
    resolve_all_project_warmup_waiters,
    resolve_project_warmup_waiters,
  ])

  useEffect(() => {
    let cancelled = false

    async function hydrate_runtime(): Promise<void> {
      try {
        // Core API 状态是共享权威源，渲染层启动或热更新时不能通过卸载工程去“重置会话”。
        // 否则开发态的 StrictMode、Fast Refresh 或整页重载都会把外部手动打开的 Py 应用状态一起清空。
        const [next_settings, next_project, next_task] = await Promise.all([
          api_fetch<SettingsSnapshotPayload>('/api/settings/app', {}),
          api_fetch<ProjectSnapshotPayload>('/api/project/snapshot', {}),
          api_fetch<TaskSnapshotPayload>('/api/tasks/snapshot', {}),
        ])
        if (cancelled) {
          return
        }

        apply_settings_snapshot(next_settings)
        set_project_snapshot(normalize_project_snapshot(next_project))
        set_task_snapshot(normalize_task_snapshot(next_task))
        set_hydration_error(null)
        set_hydration_ready(true)
      } catch (error) {
        if (cancelled) {
          return
        }

        const message = error instanceof Error ? error.message : '桌面运行时初始化失败。'
        set_hydration_error(message)
        set_hydration_ready(true)
      }
    }

    void hydrate_runtime()

    return () => {
      cancelled = true
    }
  }, [apply_settings_snapshot])

  useEffect(() => {
    let event_source: EventSource | null = null
    let cancelled = false

    function handle_project_changed(event: MessageEvent<string>): void {
      const payload = parse_event_payload(event)
      set_project_snapshot({
        path: String(payload.path ?? ''),
        loaded: Boolean(payload.loaded),
      })
      void refresh_task()
    }

    function handle_task_status_changed(event: MessageEvent<string>): void {
      const payload = parse_event_payload(event)
      set_task_snapshot((previous_snapshot) => merge_task_status_update(previous_snapshot, payload))
    }

    function handle_task_progress_changed(event: MessageEvent<string>): void {
      const payload = parse_event_payload(event)
      set_task_snapshot((previous_snapshot) => merge_task_progress_update(previous_snapshot, payload))
    }

    function handle_settings_changed(event: MessageEvent<string>): void {
      const payload = parse_event_payload(event) as SettingsChangedEventPayload

      if (typeof payload.settings === 'object' && payload.settings !== null) {
        apply_settings_snapshot({
          settings: payload.settings,
        })
      } else {
        void refresh_settings()
      }
    }

    function handle_proofreading_snapshot_invalidated(event: MessageEvent<string>): void {
      const payload = parse_event_payload(event) as ProofreadingSnapshotInvalidatedEventPayload
      set_proofreading_change_signal((previous_signal) => ({
        seq: previous_signal.seq + 1,
        reason: String(payload.reason ?? ''),
        scope: normalize_proofreading_change_scope(payload.scope),
        item_ids: normalize_item_id_array(payload.item_ids),
        rel_paths: normalize_string_array(payload.rel_paths),
        removed_rel_paths: normalize_string_array(payload.removed_rel_paths),
      }))
    }

    function handle_workbench_snapshot_changed(event: MessageEvent<string>): void {
      const payload = parse_event_payload(event) as WorkbenchSnapshotChangedEventPayload
      set_workbench_change_signal((previous_signal) => ({
        seq: previous_signal.seq + 1,
        reason: String(payload.reason ?? ''),
        scope: normalize_workbench_change_scope(payload.scope),
        rel_paths: normalize_string_array(payload.rel_paths),
        removed_rel_paths: normalize_string_array(payload.removed_rel_paths),
        order_changed: Boolean(payload.order_changed),
      }))
    }

    async function attach_event_stream(): Promise<void> {
      try {
        const next_event_source = await open_event_stream()
        if (cancelled) {
          next_event_source.close()
          return
        }

        event_source = next_event_source
        event_source.addEventListener('project.changed', handle_project_changed as EventListener)
        event_source.addEventListener('task.status_changed', handle_task_status_changed as EventListener)
        event_source.addEventListener('task.progress_changed', handle_task_progress_changed as EventListener)
        event_source.addEventListener('settings.changed', handle_settings_changed as EventListener)
        event_source.addEventListener(
          'proofreading.snapshot_invalidated',
          handle_proofreading_snapshot_invalidated as EventListener,
        )
        event_source.addEventListener(
          'workbench.snapshot_changed',
          handle_workbench_snapshot_changed as EventListener,
        )
      } catch {
        return
      }
    }

    void attach_event_stream()

    return () => {
      cancelled = true
      event_source?.close()
    }
  }, [apply_settings_snapshot, refresh_settings, refresh_task])

  const context_value = useMemo<DesktopRuntimeContextValue>(() => {
    return {
      hydration_ready,
      hydration_error,
      settings_snapshot,
      project_snapshot,
      task_snapshot,
      proofreading_change_signal,
      workbench_change_signal,
      project_warmup_status,
      pending_target_route,
      is_app_language_updating,
      set_settings_snapshot,
      set_project_snapshot,
      set_task_snapshot,
      set_project_warmup_status,
      set_pending_target_route,
      wait_for_project_warmup,
      update_app_language,
      refresh_settings,
      refresh_project,
      refresh_task,
    }
  }, [
    hydration_ready,
    hydration_error,
    settings_snapshot,
    project_snapshot,
    task_snapshot,
    proofreading_change_signal,
    workbench_change_signal,
    project_warmup_status,
    pending_target_route,
    is_app_language_updating,
    wait_for_project_warmup,
    refresh_project,
    refresh_settings,
    refresh_task,
    update_app_language,
  ])

  return (
    <DesktopRuntimeContext.Provider value={context_value}>
      {props.children}
    </DesktopRuntimeContext.Provider>
  )
}
