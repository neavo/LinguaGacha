import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api_fetch } from '@/app/desktop-api'
import {
  normalize_settings_snapshot,
  type SettingsSnapshotPayload,
} from '@/app/state/desktop-runtime-context'
import { useDesktopRuntime } from '@/app/state/use-desktop-runtime'
import { useDesktopToast } from '@/app/state/use-desktop-toast'
import { useI18n } from '@/i18n'
import {
  build_app_settings_snapshot,
  create_app_settings_pending_state,
  type AppSettingsPendingField,
  type AppSettingsPendingState,
  type AppSettingsSnapshot,
} from '@/pages/app-settings-page/types'

type SettingsUpdateRequest = Record<string, unknown>

type UseAppSettingsStateResult = {
  snapshot: AppSettingsSnapshot
  pending_state: AppSettingsPendingState
  refresh_error: string | null
  is_refreshing: boolean
  is_restart_confirm_open: boolean
  is_quit_pending: boolean
  refresh_snapshot: () => Promise<void>
  close_restart_confirm: () => void
  confirm_restart: () => Promise<void>
  update_expert_mode: (next_checked: boolean) => Promise<void>
}

export function useAppSettingsState(): UseAppSettingsStateResult {
  const {
    settings_snapshot,
    set_settings_snapshot,
    refresh_settings,
  } = useDesktopRuntime()
  const { push_toast } = useDesktopToast()
  const { t } = useI18n()
  const [snapshot, set_snapshot] = useState<AppSettingsSnapshot>(() => {
    return build_app_settings_snapshot(settings_snapshot)
  })
  const [pending_state, set_pending_state] = useState<AppSettingsPendingState>(() => {
    return create_app_settings_pending_state()
  })
  const [refresh_error, set_refresh_error] = useState<string | null>(null)
  const [is_refreshing, set_is_refreshing] = useState<boolean>(false)
  const [is_restart_confirm_open, set_is_restart_confirm_open] = useState<boolean>(false)
  const [is_quit_pending, set_is_quit_pending] = useState<boolean>(false)
  const snapshot_ref = useRef<AppSettingsSnapshot>(snapshot)
  const context_snapshot = useMemo(() => {
    return build_app_settings_snapshot(settings_snapshot)
  }, [settings_snapshot])

  useEffect(() => {
    snapshot_ref.current = snapshot
  }, [snapshot])

  useEffect(() => {
    set_snapshot(context_snapshot)
  }, [context_snapshot])

  const set_pending = useCallback((field: AppSettingsPendingField, next_pending: boolean): void => {
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
      set_snapshot(build_app_settings_snapshot(next_settings_snapshot))
      set_refresh_error(null)
    } catch (error) {
      if (error instanceof Error) {
        set_refresh_error(error.message)
      } else {
        set_refresh_error(t('app_settings_page.feedback.refresh_failed'))
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
      field: AppSettingsPendingField,
      request: SettingsUpdateRequest,
      next_snapshot: AppSettingsSnapshot,
    ): Promise<boolean> => {
      const previous_snapshot = snapshot_ref.current
      set_snapshot(next_snapshot)
      set_pending(field, true)

      try {
        const payload = await api_fetch<SettingsSnapshotPayload>('/api/settings/update', request)
        const next_settings_snapshot = normalize_settings_snapshot(payload)
        set_settings_snapshot(next_settings_snapshot)
        set_snapshot(build_app_settings_snapshot(next_settings_snapshot))
        set_refresh_error(null)
        return true
      } catch (error) {
        set_snapshot((current_snapshot) => {
          const reverted_snapshot = {
            ...current_snapshot,
          }

          if ('expert_mode' in request) {
            reverted_snapshot.expert_mode = previous_snapshot.expert_mode
          }

          return reverted_snapshot
        })

        if (error instanceof Error) {
          push_toast('error', error.message)
        } else {
          push_toast('error', t('app_settings_page.feedback.update_failed'))
        }

        return false
      } finally {
        set_pending(field, false)
      }
    },
    [push_toast, set_pending, set_settings_snapshot, t],
  )

  const open_restart_confirm = useCallback((): void => {
    // 这些设置都要重启后生效，统一复用同一套确认退出弹框。
    set_is_restart_confirm_open(true)
  }, [])

  const close_restart_confirm = useCallback((): void => {
    set_is_restart_confirm_open(false)
  }, [])

  const update_expert_mode = useCallback(
    async (next_checked: boolean): Promise<void> => {
      const previous_snapshot = snapshot_ref.current

      if (previous_snapshot.expert_mode === next_checked) {
        return
      }

      const update_succeeded = await commit_update('expert_mode', {
        expert_mode: next_checked,
      }, {
        ...previous_snapshot,
        expert_mode: next_checked,
      })

      if (update_succeeded) {
        open_restart_confirm()
      }
    },
    [commit_update, open_restart_confirm],
  )

  const confirm_restart = useCallback(async (): Promise<void> => {
    set_is_quit_pending(true)

    try {
      await window.desktopApp.quitApp()
    } catch (error) {
      if (error instanceof Error) {
        push_toast('error', error.message)
      } else {
        push_toast('error', t('app_settings_page.feedback.quit_failed'))
      }
    } finally {
      set_is_quit_pending(false)
    }
  }, [push_toast, t])

  const value = useMemo<UseAppSettingsStateResult>(() => {
    return {
      snapshot,
      pending_state,
      refresh_error,
      is_refreshing,
      is_restart_confirm_open,
      is_quit_pending,
      refresh_snapshot,
      close_restart_confirm,
      confirm_restart,
      update_expert_mode,
    }
  }, [
    close_restart_confirm,
    confirm_restart,
    is_quit_pending,
    is_refreshing,
    is_restart_confirm_open,
    pending_state,
    refresh_error,
    refresh_snapshot,
    snapshot,
    update_expert_mode,
  ])

  return value
}

