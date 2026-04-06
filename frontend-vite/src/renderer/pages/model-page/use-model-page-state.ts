import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api_fetch } from '@/app/desktop-api'
import { useDesktopRuntime } from '@/app/state/use-desktop-runtime'
import { useDesktopToast } from '@/app/state/use-desktop-toast'
import { useI18n } from '@/i18n'
import type {
  ModelCategorySnapshot,
  ModelConfirmState,
  ModelDialogState,
  ModelEntrySnapshot,
  ModelGenerationSnapshot,
  ModelPageSnapshot,
  ModelRequestSnapshot,
  ModelSelectorState,
  ModelTestResult,
  ModelThinkingLevel,
  ModelThinkingSnapshot,
  ModelThresholdSnapshot,
  ModelType,
} from '@/pages/model-page/types'

type ModelPageSnapshotPayload = {
  snapshot?: Partial<ModelPageSnapshot> & {
    models?: Array<Partial<ModelEntrySnapshot>>
  }
}

type ModelListPayload = {
  models?: string[]
}

type ModelTestPayload = Partial<ModelTestResult> & {
  key_results?: Array<Partial<ModelTestResult['key_results'][number]>>
}

type UseModelPageStateResult = {
  snapshot: ModelPageSnapshot
  grouped_categories: ModelCategorySnapshot[]
  refresh_error: string | null
  is_refreshing: boolean
  readonly: boolean
  dialog_state: ModelDialogState
  confirm_state: ModelConfirmState
  selector_state: ModelSelectorState
  active_dialog_model: ModelEntrySnapshot | null
  refresh_snapshot: () => Promise<void>
  request_add_model: (model_type: ModelType) => Promise<void>
  request_activate_model: (model_id: string) => Promise<void>
  request_delete_model: (model_id: string) => void
  request_reset_model: (model_id: string) => void
  request_reorder_models: (model_type: ModelType, ordered_model_ids: string[]) => Promise<void>
  update_model_patch: (model_id: string, patch: Record<string, unknown>) => Promise<void>
  request_test_model: (model_id: string) => Promise<void>
  open_dialog: (kind: Exclude<ModelDialogState['kind'], null>, model_id: string) => void
  close_dialog: () => void
  confirm_dialog: () => Promise<void>
  close_confirm: () => void
  open_selector_dialog: (model_id: string) => void
  close_selector_dialog: () => void
  set_selector_filter_text: (next_text: string) => void
  load_available_models: (model_id: string) => Promise<void>
  select_model_id: (model_name: string) => Promise<void>
}

const MODEL_TYPE_ORDER: ModelType[] = [
  'PRESET',
  'CUSTOM_GOOGLE',
  'CUSTOM_OPENAI',
  'CUSTOM_ANTHROPIC',
]

const DEFAULT_THRESHOLD_SNAPSHOT: ModelThresholdSnapshot = {
  input_token_limit: 512,
  output_token_limit: 4096,
  rpm_limit: 0,
  concurrency_limit: 0,
}

const DEFAULT_GENERATION_SNAPSHOT: ModelGenerationSnapshot = {
  temperature: 0.95,
  temperature_custom_enable: false,
  top_p: 0.95,
  top_p_custom_enable: false,
  presence_penalty: 0,
  presence_penalty_custom_enable: false,
  frequency_penalty: 0,
  frequency_penalty_custom_enable: false,
}

const EMPTY_SNAPSHOT: ModelPageSnapshot = {
  active_model_id: '',
  models: [],
}

function close_dialog_state(): ModelDialogState {
  return {
    kind: null,
    model_id: null,
  }
}

function close_confirm_state(): ModelConfirmState {
  return {
    kind: null,
    model_id: null,
  }
}

function create_selector_state(): ModelSelectorState {
  return {
    open: false,
    model_id: null,
    available_models: [],
    filter_text: '',
    is_loading: false,
  }
}

function normalize_model_type(candidate: unknown): ModelType {
  if (candidate === 'CUSTOM_GOOGLE') {
    return 'CUSTOM_GOOGLE'
  } else if (candidate === 'CUSTOM_OPENAI') {
    return 'CUSTOM_OPENAI'
  } else if (candidate === 'CUSTOM_ANTHROPIC') {
    return 'CUSTOM_ANTHROPIC'
  } else {
    return 'PRESET'
  }
}

function normalize_thinking_level(candidate: unknown): ModelThinkingLevel {
  if (candidate === 'LOW') {
    return 'LOW'
  } else if (candidate === 'MEDIUM') {
    return 'MEDIUM'
  } else if (candidate === 'HIGH') {
    return 'HIGH'
  } else {
    return 'OFF'
  }
}

function read_number(candidate: unknown, fallback_value: number): number {
  const parsed_value = Number(candidate)
  if (Number.isFinite(parsed_value)) {
    return parsed_value
  } else {
    return fallback_value
  }
}

function normalize_request_snapshot(candidate: unknown): ModelRequestSnapshot {
  const source = typeof candidate === 'object' && candidate !== null
    ? candidate as Record<string, unknown>
    : {}
  const headers_source = typeof source.extra_headers === 'object' && source.extra_headers !== null
    ? source.extra_headers as Record<string, unknown>
    : {}
  const body_source = typeof source.extra_body === 'object' && source.extra_body !== null
    ? source.extra_body as Record<string, unknown>
    : {}

  return {
    extra_headers: Object.fromEntries(
      Object.entries(headers_source).map(([key, value]) => {
        return [String(key), String(value)]
      }),
    ),
    extra_headers_custom_enable: Boolean(source.extra_headers_custom_enable),
    extra_body: { ...body_source },
    extra_body_custom_enable: Boolean(source.extra_body_custom_enable),
  }
}

function normalize_threshold_snapshot(candidate: unknown): ModelThresholdSnapshot {
  const source = typeof candidate === 'object' && candidate !== null
    ? candidate as Record<string, unknown>
    : {}

  return {
    input_token_limit: read_number(source.input_token_limit, DEFAULT_THRESHOLD_SNAPSHOT.input_token_limit),
    output_token_limit: read_number(source.output_token_limit, DEFAULT_THRESHOLD_SNAPSHOT.output_token_limit),
    rpm_limit: read_number(source.rpm_limit, DEFAULT_THRESHOLD_SNAPSHOT.rpm_limit),
    concurrency_limit: read_number(source.concurrency_limit, DEFAULT_THRESHOLD_SNAPSHOT.concurrency_limit),
  }
}

function normalize_thinking_snapshot(candidate: unknown): ModelThinkingSnapshot {
  const source = typeof candidate === 'object' && candidate !== null
    ? candidate as Record<string, unknown>
    : {}

  return {
    level: normalize_thinking_level(source.level),
  }
}

function normalize_generation_snapshot(candidate: unknown): ModelGenerationSnapshot {
  const source = typeof candidate === 'object' && candidate !== null
    ? candidate as Record<string, unknown>
    : {}

  return {
    temperature: read_number(source.temperature, DEFAULT_GENERATION_SNAPSHOT.temperature),
    temperature_custom_enable: Boolean(source.temperature_custom_enable),
    top_p: read_number(source.top_p, DEFAULT_GENERATION_SNAPSHOT.top_p),
    top_p_custom_enable: Boolean(source.top_p_custom_enable),
    presence_penalty: read_number(source.presence_penalty, DEFAULT_GENERATION_SNAPSHOT.presence_penalty),
    presence_penalty_custom_enable: Boolean(source.presence_penalty_custom_enable),
    frequency_penalty: read_number(source.frequency_penalty, DEFAULT_GENERATION_SNAPSHOT.frequency_penalty),
    frequency_penalty_custom_enable: Boolean(source.frequency_penalty_custom_enable),
  }
}

function normalize_model_entry(candidate: Partial<ModelEntrySnapshot> | undefined): ModelEntrySnapshot {
  const source = typeof candidate === 'object' && candidate !== null
    ? candidate as Record<string, unknown>
    : {}

  return {
    id: String(source.id ?? ''),
    type: normalize_model_type(source.type),
    name: String(source.name ?? ''),
    api_format: String(source.api_format ?? 'OpenAI'),
    api_url: String(source.api_url ?? ''),
    api_key: String(source.api_key ?? ''),
    model_id: String(source.model_id ?? ''),
    request: normalize_request_snapshot(source.request),
    threshold: normalize_threshold_snapshot(source.threshold),
    thinking: normalize_thinking_snapshot(source.thinking),
    generation: normalize_generation_snapshot(source.generation),
  }
}

function normalize_model_page_snapshot(payload: ModelPageSnapshotPayload): ModelPageSnapshot {
  const snapshot = payload.snapshot ?? {}
  const models = Array.isArray(snapshot.models)
    ? snapshot.models
      .map((model) => normalize_model_entry(model))
      .filter((model) => model.id !== '')
    : []
  const active_model_id = String(snapshot.active_model_id ?? '')

  return {
    active_model_id,
    models,
  }
}

function normalize_model_test_result(payload: ModelTestPayload): ModelTestResult {
  const key_results = Array.isArray(payload.key_results)
    ? payload.key_results.map((key_result) => {
      return {
        masked_key: String(key_result.masked_key ?? ''),
        success: Boolean(key_result.success),
        input_tokens: read_number(key_result.input_tokens, 0),
        output_tokens: read_number(key_result.output_tokens, 0),
        response_time_ms: read_number(key_result.response_time_ms, 0),
        error_reason: String(key_result.error_reason ?? ''),
      }
    })
    : []

  return {
    success: Boolean(payload.success),
    result_msg: String(payload.result_msg ?? ''),
    total_count: read_number(payload.total_count, 0),
    success_count: read_number(payload.success_count, 0),
    failure_count: read_number(payload.failure_count, 0),
    total_response_time_ms: read_number(payload.total_response_time_ms, 0),
    key_results,
  }
}

function find_model(snapshot: ModelPageSnapshot, model_id: string | null): ModelEntrySnapshot | null {
  if (model_id === null || model_id === '') {
    return null
  } else {
    return snapshot.models.find((model) => model.id === model_id) ?? null
  }
}

function merge_model_patch(model: ModelEntrySnapshot, patch: Record<string, unknown>): ModelEntrySnapshot {
  const request_source = typeof patch.request === 'object' && patch.request !== null
    ? {
        ...model.request,
        ...(patch.request as Record<string, unknown>),
      }
    : model.request
  const threshold_source = typeof patch.threshold === 'object' && patch.threshold !== null
    ? {
        ...model.threshold,
        ...(patch.threshold as Record<string, unknown>),
      }
    : model.threshold
  const thinking_source = typeof patch.thinking === 'object' && patch.thinking !== null
    ? {
        ...model.thinking,
        ...(patch.thinking as Record<string, unknown>),
      }
    : model.thinking
  const generation_source = typeof patch.generation === 'object' && patch.generation !== null
    ? {
        ...model.generation,
        ...(patch.generation as Record<string, unknown>),
      }
    : model.generation

  return {
    ...model,
    name: patch.name === undefined ? model.name : String(patch.name),
    api_url: patch.api_url === undefined ? model.api_url : String(patch.api_url),
    api_key: patch.api_key === undefined ? model.api_key : String(patch.api_key),
    model_id: patch.model_id === undefined ? model.model_id : String(patch.model_id),
    request: normalize_request_snapshot(request_source),
    threshold: normalize_threshold_snapshot(threshold_source),
    thinking: normalize_thinking_snapshot(thinking_source),
    generation: normalize_generation_snapshot(generation_source),
  }
}

function apply_model_patch(snapshot: ModelPageSnapshot, model_id: string, patch: Record<string, unknown>): ModelPageSnapshot {
  return {
    ...snapshot,
    models: snapshot.models.map((model) => {
      if (model.id === model_id) {
        return merge_model_patch(model, patch)
      } else {
        return model
      }
    }),
  }
}

function reorder_snapshot_group(snapshot: ModelPageSnapshot, model_type: ModelType, ordered_model_ids: string[]): ModelPageSnapshot {
  const group_models = snapshot.models.filter((model) => model.type === model_type)
  const current_group_ids = group_models.map((model) => model.id)

  if (current_group_ids.length !== ordered_model_ids.length) {
    return snapshot
  }
  if (new Set(ordered_model_ids).size !== ordered_model_ids.length) {
    return snapshot
  }
  if (!ordered_model_ids.every((model_id) => current_group_ids.includes(model_id))) {
    return snapshot
  }

  const group_model_map = new Map(group_models.map((model) => [model.id, model]))
  const reordered_group_models = ordered_model_ids.map((model_id) => group_model_map.get(model_id)).filter((model) => model !== undefined)

  if (reordered_group_models.length !== group_models.length) {
    return snapshot
  }

  let group_index = 0
  const next_models = snapshot.models.map((model) => {
    if (model.type === model_type) {
      const next_model = reordered_group_models[group_index]
      group_index += 1
      return next_model
    } else {
      return model
    }
  })

  return {
    ...snapshot,
    models: next_models,
  }
}

function get_category_title(t: (key: Parameters<ReturnType<typeof useI18n>['t']>[0]) => string, model_type: ModelType): string {
  if (model_type === 'PRESET') {
    return t('model_page.category.preset.title')
  } else if (model_type === 'CUSTOM_GOOGLE') {
    return t('model_page.category.custom_google.title')
  } else if (model_type === 'CUSTOM_OPENAI') {
    return t('model_page.category.custom_openai.title')
  } else {
    return t('model_page.category.custom_anthropic.title')
  }
}

function get_category_description(t: (key: Parameters<ReturnType<typeof useI18n>['t']>[0]) => string, model_type: ModelType): string {
  if (model_type === 'PRESET') {
    return t('model_page.category.preset.description')
  } else if (model_type === 'CUSTOM_GOOGLE') {
    return t('model_page.category.custom_google.description')
  } else if (model_type === 'CUSTOM_OPENAI') {
    return t('model_page.category.custom_openai.description')
  } else {
    return t('model_page.category.custom_anthropic.description')
  }
}

function get_category_accent_color(model_type: ModelType): string {
  if (model_type === 'PRESET') {
    return 'var(--model-page-accent-preset)'
  } else if (model_type === 'CUSTOM_GOOGLE') {
    return 'var(--model-page-accent-google)'
  } else if (model_type === 'CUSTOM_OPENAI') {
    return 'var(--model-page-accent-openai)'
  } else {
    return 'var(--model-page-accent-anthropic)'
  }
}

export function useModelPageState(): UseModelPageStateResult {
  const { t } = useI18n()
  const { push_toast } = useDesktopToast()
  const { task_snapshot } = useDesktopRuntime()
  const [snapshot, set_snapshot] = useState<ModelPageSnapshot>(EMPTY_SNAPSHOT)
  const [refresh_error, set_refresh_error] = useState<string | null>(null)
  const [is_refreshing, set_is_refreshing] = useState(false)
  const [is_action_running, set_is_action_running] = useState(false)
  const [dialog_state, set_dialog_state] = useState<ModelDialogState>(close_dialog_state())
  const [confirm_state, set_confirm_state] = useState<ModelConfirmState>(close_confirm_state())
  const [selector_state, set_selector_state] = useState<ModelSelectorState>(create_selector_state())
  const snapshot_ref = useRef<ModelPageSnapshot>(snapshot)
  const patch_request_seed_ref = useRef(0)
  const latest_patch_request_id_by_model_ref = useRef<Record<string, number>>({})

  useEffect(() => {
    snapshot_ref.current = snapshot
  }, [snapshot])

  const refresh_snapshot = useCallback(async (): Promise<void> => {
    set_is_refreshing(true)

    try {
      const payload = await api_fetch<ModelPageSnapshotPayload>('/api/models/snapshot', {})
      const next_snapshot = normalize_model_page_snapshot(payload)
      set_snapshot(next_snapshot)
      set_refresh_error(null)
    } catch (error) {
      if (error instanceof Error) {
        set_refresh_error(error.message)
      } else {
        set_refresh_error(t('model_page.feedback.refresh_failed'))
      }
    } finally {
      set_is_refreshing(false)
    }
  }, [t])

  useEffect(() => {
    void refresh_snapshot()
  }, [refresh_snapshot])

  const grouped_categories = useMemo<ModelCategorySnapshot[]>(() => {
    return MODEL_TYPE_ORDER.map((model_type) => {
      return {
        type: model_type,
        title: get_category_title(t, model_type),
        description: get_category_description(t, model_type),
        accent_color: get_category_accent_color(model_type),
        can_add: model_type !== 'PRESET',
        models: snapshot.models.filter((model) => model.type === model_type),
      }
    })
  }, [snapshot.models, t])

  const active_dialog_model = useMemo(() => {
    return find_model(snapshot, dialog_state.model_id)
  }, [dialog_state.model_id, snapshot])

  const readonly = task_snapshot.busy || is_action_running

  const update_model_patch = useCallback(async (model_id: string, patch: Record<string, unknown>): Promise<void> => {
    if (model_id === '') {
      return
    }

    const previous_snapshot = snapshot_ref.current
    const optimistic_snapshot = apply_model_patch(previous_snapshot, model_id, patch)
    patch_request_seed_ref.current += 1
    const request_id = patch_request_seed_ref.current
    latest_patch_request_id_by_model_ref.current[model_id] = request_id

    set_snapshot(optimistic_snapshot)

    try {
      const payload = await api_fetch<ModelPageSnapshotPayload>('/api/models/update', {
        model_id,
        patch,
      })
      const next_snapshot = normalize_model_page_snapshot(payload)
      if (latest_patch_request_id_by_model_ref.current[model_id] === request_id) {
        set_snapshot(next_snapshot)
        set_refresh_error(null)
      }
    } catch (error) {
      if (latest_patch_request_id_by_model_ref.current[model_id] === request_id) {
        if (error instanceof Error) {
          push_toast('error', error.message)
        } else {
          push_toast('error', t('model_page.feedback.update_failed'))
        }
        void refresh_snapshot()
      }
    }
  }, [push_toast, refresh_snapshot, t])

  const request_add_model = useCallback(async (model_type: ModelType): Promise<void> => {
    if (readonly) {
      return
    }

    set_is_action_running(true)

    try {
      const payload = await api_fetch<ModelPageSnapshotPayload>('/api/models/add', {
        model_type,
      })
      set_snapshot(normalize_model_page_snapshot(payload))
      set_refresh_error(null)
    } catch (error) {
      if (error instanceof Error) {
        push_toast('error', error.message)
      } else {
        push_toast('error', t('model_page.feedback.add_failed'))
      }
    } finally {
      set_is_action_running(false)
    }
  }, [push_toast, readonly, t])

  const request_activate_model = useCallback(async (model_id: string): Promise<void> => {
    if (readonly) {
      return
    }
    if (snapshot_ref.current.active_model_id === model_id) {
      return
    }

    set_is_action_running(true)

    try {
      const payload = await api_fetch<ModelPageSnapshotPayload>('/api/models/activate', {
        model_id,
      })
      set_snapshot(normalize_model_page_snapshot(payload))
      set_refresh_error(null)
    } catch (error) {
      if (error instanceof Error) {
        push_toast('error', error.message)
      } else {
        push_toast('error', t('model_page.feedback.update_failed'))
      }
    } finally {
      set_is_action_running(false)
    }
  }, [push_toast, readonly, t])

  const request_delete_model = useCallback((model_id: string): void => {
    const model = find_model(snapshot_ref.current, model_id)
    if (model === null) {
      return
    }

    const group_count = snapshot_ref.current.models.filter((entry) => entry.type === model.type).length
    if (group_count <= 1) {
      push_toast('warning', t('model_page.feedback.delete_last_one'))
    } else {
      set_confirm_state({
        kind: 'delete',
        model_id,
      })
    }
  }, [push_toast, t])

  const request_reset_model = useCallback((model_id: string): void => {
    set_confirm_state({
      kind: 'reset',
      model_id,
    })
  }, [])

  const request_reorder_models = useCallback(async (model_type: ModelType, ordered_model_ids: string[]): Promise<void> => {
    if (readonly) {
      return
    }

    const previous_snapshot = snapshot_ref.current
    const optimistic_snapshot = reorder_snapshot_group(previous_snapshot, model_type, ordered_model_ids)
    if (optimistic_snapshot === previous_snapshot) {
      return
    }

    set_snapshot(optimistic_snapshot)
    set_is_action_running(true)

    try {
      const payload = await api_fetch<ModelPageSnapshotPayload>('/api/models/reorder', {
        ordered_model_ids,
      })
      set_snapshot(normalize_model_page_snapshot(payload))
      set_refresh_error(null)
    } catch {
      set_snapshot(previous_snapshot)
      push_toast('error', t('model_page.feedback.reorder_failed'))
    } finally {
      set_is_action_running(false)
    }
  }, [push_toast, readonly, t])

  const request_test_model = useCallback(async (model_id: string): Promise<void> => {
    if (readonly) {
      return
    }

    set_is_action_running(true)

    try {
      const payload = await api_fetch<ModelTestPayload>('/api/models/test', {
        model_id,
      })
      const result = normalize_model_test_result(payload)
      if (result.success) {
        push_toast('success', result.result_msg)
      } else {
        push_toast('error', result.result_msg === '' ? t('model_page.feedback.test_failed') : result.result_msg)
      }
    } catch (error) {
      if (error instanceof Error) {
        push_toast('error', error.message)
      } else {
        push_toast('error', t('model_page.feedback.test_failed'))
      }
    } finally {
      set_is_action_running(false)
    }
  }, [push_toast, readonly, t])

  function open_dialog(kind: Exclude<ModelDialogState['kind'], null>, model_id: string): void {
    set_dialog_state({
      kind,
      model_id,
    })
  }

  function close_dialog(): void {
    set_dialog_state(close_dialog_state())
  }

  const confirm_dialog = useCallback(async (): Promise<void> => {
    const current_confirm_state = confirm_state
    set_confirm_state(close_confirm_state())

    if (current_confirm_state.kind === null || current_confirm_state.model_id === null) {
      return
    }
    if (readonly) {
      return
    }

    set_is_action_running(true)

    try {
      if (current_confirm_state.kind === 'delete') {
        const payload = await api_fetch<ModelPageSnapshotPayload>('/api/models/delete', {
          model_id: current_confirm_state.model_id,
        })
        set_snapshot(normalize_model_page_snapshot(payload))
        if (dialog_state.model_id === current_confirm_state.model_id) {
          set_dialog_state(close_dialog_state())
        }
      } else if (current_confirm_state.kind === 'reset') {
        const payload = await api_fetch<ModelPageSnapshotPayload>('/api/models/reset-preset', {
          model_id: current_confirm_state.model_id,
        })
        set_snapshot(normalize_model_page_snapshot(payload))
        push_toast('success', t('model_page.feedback.reset_success'))
      }
      set_refresh_error(null)
    } catch (error) {
      if (error instanceof Error) {
        push_toast('error', error.message)
      } else {
        push_toast('error', t('model_page.feedback.update_failed'))
      }
    } finally {
      set_is_action_running(false)
    }
  }, [confirm_state, dialog_state.model_id, push_toast, readonly, t])

  function close_confirm(): void {
    set_confirm_state(close_confirm_state())
  }

  function open_selector_dialog(model_id: string): void {
    set_selector_state((previous_state) => {
      return {
        ...previous_state,
        open: true,
        model_id,
        filter_text: '',
      }
    })
  }

  function close_selector_dialog(): void {
    set_selector_state((previous_state) => {
      return {
        ...previous_state,
        open: false,
        model_id: null,
        filter_text: '',
      }
    })
  }

  function set_selector_filter_text(next_text: string): void {
    set_selector_state((previous_state) => {
      return {
        ...previous_state,
        filter_text: next_text,
      }
    })
  }

  const load_available_models = useCallback(async (model_id: string): Promise<void> => {
    set_selector_state((previous_state) => {
      return {
        ...previous_state,
        open: true,
        model_id,
        is_loading: true,
      }
    })

    try {
      const payload = await api_fetch<ModelListPayload>('/api/models/list-available', {
        model_id,
      })
      set_selector_state((previous_state) => {
        return {
          ...previous_state,
          model_id,
          available_models: Array.isArray(payload.models)
            ? payload.models.map((model_name) => String(model_name))
            : [],
          is_loading: false,
        }
      })
    } catch (error) {
      set_selector_state((previous_state) => {
        return {
          ...previous_state,
          available_models: [],
          is_loading: false,
        }
      })
      if (error instanceof Error) {
        push_toast('error', error.message)
      } else {
        push_toast('error', t('model_page.feedback.selector_load_failed'))
      }
    }
  }, [push_toast, t])

  const select_model_id = useCallback(async (model_name: string): Promise<void> => {
    const target_model_id = selector_state.model_id
    if (target_model_id === null) {
      return
    }

    await update_model_patch(target_model_id, {
      model_id: model_name,
    })
    close_selector_dialog()
  }, [selector_state.model_id, update_model_patch])

  return {
    snapshot,
    grouped_categories,
    refresh_error,
    is_refreshing,
    readonly,
    dialog_state,
    confirm_state,
    selector_state,
    active_dialog_model,
    refresh_snapshot,
    request_add_model,
    request_activate_model,
    request_delete_model,
    request_reset_model,
    request_reorder_models,
    update_model_patch,
    request_test_model,
    open_dialog,
    close_dialog,
    confirm_dialog,
    close_confirm,
    open_selector_dialog,
    close_selector_dialog,
    set_selector_filter_text,
    load_available_models,
    select_model_id,
  }
}
