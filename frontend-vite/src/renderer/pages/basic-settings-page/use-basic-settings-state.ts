import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { DesktopApiError, api_fetch } from '@/app/desktop-api'
import {
  normalize_settings_snapshot,
  type SettingsSnapshotPayload,
} from '@/app/state/desktop-runtime-context'
import { useDesktopRuntime } from '@/app/state/use-desktop-runtime'
import { useDesktopToast } from '@/app/state/use-desktop-toast'
import { useI18n } from '@/i18n'
import {
  PROJECT_SAVE_MODE,
  REQUEST_TIMEOUT_MAX,
  REQUEST_TIMEOUT_MIN,
  build_basic_settings_snapshot,
  type BasicSettingsPendingField,
  type BasicSettingsSnapshot,
  type ProjectSaveMode,
  type SettingPendingState,
} from '@/pages/basic-settings-page/types'

type SettingsUpdateRequest = Record<string, unknown>

type UseBasicSettingsStateResult = {
  snapshot: BasicSettingsSnapshot
  pending_state: SettingPendingState
  refresh_error: string | null
  is_refreshing: boolean
  is_task_busy: boolean
  refresh_snapshot: () => Promise<void>
  update_source_language: (next_language: string) => Promise<void>
  update_target_language: (next_language: string) => Promise<void>
  update_project_save_mode: (next_mode: ProjectSaveMode) => Promise<void>
  update_output_folder_open_on_finish: (next_checked: boolean) => Promise<void>
  update_request_timeout: (next_value: number) => Promise<void>
}

function create_pending_state(): SettingPendingState {
  return {
    source_language: false,
    target_language: false,
    project_save_mode: false,
    output_folder_open_on_finish: false,
    request_timeout: false,
  }
}

function clamp_request_timeout(next_value: number): number {
  return Math.min(REQUEST_TIMEOUT_MAX, Math.max(REQUEST_TIMEOUT_MIN, next_value))
}

export function useBasicSettingsState(): UseBasicSettingsStateResult {
  const {
    settings_snapshot,
    task_snapshot,
    set_settings_snapshot,
    refresh_settings,
  } = useDesktopRuntime()
  const { push_toast } = useDesktopToast()
  const { t } = useI18n()
  const [snapshot, set_snapshot] = useState<BasicSettingsSnapshot>(() => {
    return build_basic_settings_snapshot(settings_snapshot)
  })
  const [pending_state, set_pending_state] = useState<SettingPendingState>(() => {
    return create_pending_state()
  })
  const [refresh_error, set_refresh_error] = useState<string | null>(null)
  const [is_refreshing, set_is_refreshing] = useState<boolean>(false)
  const snapshot_ref = useRef<BasicSettingsSnapshot>(snapshot)
  const context_snapshot = useMemo(() => {
    return build_basic_settings_snapshot(settings_snapshot)
  }, [settings_snapshot])

  useEffect(() => {
    snapshot_ref.current = snapshot
  }, [snapshot])

  useEffect(() => {
    set_snapshot(context_snapshot)
  }, [context_snapshot])

  const is_task_busy = task_snapshot.busy

  const set_pending = useCallback((field: BasicSettingsPendingField, next_pending: boolean): void => {
    set_pending_state((previous_state) => {
      return {
        ...previous_state,
        [field]: next_pending,
      }
    })
  }, [])

  const refresh_snapshot = useCallback(async (): Promise<void> => {
    set_is_refreshing(true)

    try {
      const next_settings_snapshot = await refresh_settings()
      set_snapshot(build_basic_settings_snapshot(next_settings_snapshot))
      set_refresh_error(null)
    } catch (error) {
      if (error instanceof Error) {
        set_refresh_error(error.message)
      } else {
        set_refresh_error(t('setting.page.basic.feedback.refresh_failed'))
      }
    } finally {
      set_is_refreshing(false)
    }
  }, [refresh_settings, t])

  useEffect(() => {
    void refresh_snapshot()
  }, [refresh_snapshot])

  const commit_update = useCallback(
    async (
      field: BasicSettingsPendingField,
      request: SettingsUpdateRequest,
      next_snapshot: BasicSettingsSnapshot,
    ): Promise<void> => {
      const previous_snapshot = snapshot_ref.current
      set_snapshot(next_snapshot)
      set_pending(field, true)

      try {
        const payload = await api_fetch<SettingsSnapshotPayload>('/api/settings/update', request)
        const next_settings_snapshot = normalize_settings_snapshot(payload)
        set_settings_snapshot(next_settings_snapshot)
        set_snapshot(build_basic_settings_snapshot(next_settings_snapshot))
        set_refresh_error(null)
      } catch (error) {
        set_snapshot((current_snapshot) => {
          const reverted_snapshot = {
            ...current_snapshot,
          }

          if ('source_language' in request) {
            reverted_snapshot.source_language = previous_snapshot.source_language
          }
          if ('target_language' in request) {
            reverted_snapshot.target_language = previous_snapshot.target_language
          }
          if ('project_save_mode' in request) {
            reverted_snapshot.project_save_mode = previous_snapshot.project_save_mode
          }
          if ('project_fixed_path' in request) {
            reverted_snapshot.project_fixed_path = previous_snapshot.project_fixed_path
          }
          if ('output_folder_open_on_finish' in request) {
            reverted_snapshot.output_folder_open_on_finish = previous_snapshot.output_folder_open_on_finish
          }
          if ('request_timeout' in request) {
            reverted_snapshot.request_timeout = previous_snapshot.request_timeout
          }

          return reverted_snapshot
        })

        if (error instanceof Error) {
          push_toast('error', error.message)
        } else {
          push_toast('error', t('setting.page.basic.feedback.update_failed'))
        }
      } finally {
        set_pending(field, false)
      }
    },
    [push_toast, set_pending, set_settings_snapshot, t],
  )

  const update_source_language = useCallback(
    async (next_language: string): Promise<void> => {
      const previous_snapshot = snapshot_ref.current

      if (is_task_busy || previous_snapshot.source_language === next_language) {
        return
      }

      await commit_update('source_language', {
        source_language: next_language,
      }, {
        ...previous_snapshot,
        source_language: next_language,
      })
    },
    [commit_update, is_task_busy],
  )

  const update_target_language = useCallback(
    async (next_language: string): Promise<void> => {
      const previous_snapshot = snapshot_ref.current

      if (is_task_busy || previous_snapshot.target_language === next_language) {
        return
      }

      await commit_update('target_language', {
        target_language: next_language,
      }, {
        ...previous_snapshot,
        target_language: next_language,
      })
    },
    [commit_update, is_task_busy],
  )

  const update_project_save_mode = useCallback(
    async (next_mode: ProjectSaveMode): Promise<void> => {
      const previous_snapshot = snapshot_ref.current

      if (previous_snapshot.project_save_mode === next_mode) {
        return
      }

      if (next_mode === PROJECT_SAVE_MODE.FIXED) {
        try {
          const result = await window.desktopApp.pickFixedProjectDirectory(previous_snapshot.project_fixed_path)
          if (result.canceled || result.path === null || result.path === '') {
            return
          }

          await commit_update('project_save_mode', {
            project_save_mode: next_mode,
            project_fixed_path: result.path,
          }, {
            ...previous_snapshot,
            project_save_mode: next_mode,
            project_fixed_path: result.path,
          })
        } catch (error) {
          if (error instanceof DesktopApiError) {
            push_toast('error', error.message)
          } else {
            push_toast('error', t('setting.page.basic.feedback.pick_directory_failed'))
          }
        }
      } else {
        await commit_update('project_save_mode', {
          project_save_mode: next_mode,
        }, {
          ...previous_snapshot,
          project_save_mode: next_mode,
        })
      }
    },
    [commit_update, push_toast, t],
  )

  const update_output_folder_open_on_finish = useCallback(
    async (next_checked: boolean): Promise<void> => {
      const previous_snapshot = snapshot_ref.current

      if (previous_snapshot.output_folder_open_on_finish === next_checked) {
        return
      }

      await commit_update('output_folder_open_on_finish', {
        output_folder_open_on_finish: next_checked,
      }, {
        ...previous_snapshot,
        output_folder_open_on_finish: next_checked,
      })
    },
    [commit_update],
  )

  const update_request_timeout = useCallback(
    async (next_value: number): Promise<void> => {
      const previous_snapshot = snapshot_ref.current
      const normalized_timeout = clamp_request_timeout(next_value)

      if (Number.isNaN(normalized_timeout) || previous_snapshot.request_timeout === normalized_timeout) {
        return
      }

      await commit_update('request_timeout', {
        request_timeout: normalized_timeout,
      }, {
        ...previous_snapshot,
        request_timeout: normalized_timeout,
      })
    },
    [commit_update],
  )

  const value = useMemo<UseBasicSettingsStateResult>(() => {
    return {
      snapshot,
      pending_state,
      refresh_error,
      is_refreshing,
      is_task_busy,
      refresh_snapshot,
      update_source_language,
      update_target_language,
      update_project_save_mode,
      update_output_folder_open_on_finish,
      update_request_timeout,
    }
  }, [
    is_refreshing,
    is_task_busy,
    pending_state,
    refresh_error,
    refresh_snapshot,
    snapshot,
    update_output_folder_open_on_finish,
    update_project_save_mode,
    update_request_timeout,
    update_source_language,
    update_target_language,
  ])

  return value
}
