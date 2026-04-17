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
  build_laboratory_snapshot,
  type LaboratoryPendingField,
  type LaboratoryPendingState,
  type LaboratorySnapshot,
} from '@/pages/laboratory-page/types'

type SettingsUpdateRequest = Record<string, unknown>

type UseLaboratoryPageStateResult = {
  snapshot: LaboratorySnapshot
  pending_state: LaboratoryPendingState
  refresh_error: string | null
  is_refreshing: boolean
  is_task_busy: boolean
  refresh_snapshot: () => Promise<void>
  update_mtool_optimizer_enable: (next_checked: boolean) => Promise<void>
}

function create_pending_state(): LaboratoryPendingState {
  return {
    mtool_optimizer_enable: false,
  }
}

export function useLaboratoryPageState(): UseLaboratoryPageStateResult {
  const {
    settings_snapshot,
    task_snapshot,
    set_settings_snapshot,
    refresh_settings,
  } = useDesktopRuntime()
  const { push_toast } = useDesktopToast()
  const { t } = useI18n()
  const [snapshot, set_snapshot] = useState<LaboratorySnapshot>(() => {
    return build_laboratory_snapshot(settings_snapshot)
  })
  const [pending_state, set_pending_state] = useState<LaboratoryPendingState>(() => {
    return create_pending_state()
  })
  const [refresh_error, set_refresh_error] = useState<string | null>(null)
  const [is_refreshing, set_is_refreshing] = useState<boolean>(false)
  const snapshot_ref = useRef<LaboratorySnapshot>(snapshot)
  const context_snapshot = useMemo(() => {
    return build_laboratory_snapshot(settings_snapshot)
  }, [settings_snapshot])

  useEffect(() => {
    snapshot_ref.current = snapshot
  }, [snapshot])

  useEffect(() => {
    set_snapshot(context_snapshot)
  }, [context_snapshot])

  const is_task_busy = task_snapshot.busy

  const set_pending = useCallback((field: LaboratoryPendingField, next_pending: boolean): void => {
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
      set_snapshot(build_laboratory_snapshot(next_settings_snapshot))
      set_refresh_error(null)
    } catch (error) {
      if (error instanceof Error) {
        set_refresh_error(error.message)
      } else {
        set_refresh_error(t('laboratory_page.feedback.refresh_failed'))
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
      field: LaboratoryPendingField,
      request: SettingsUpdateRequest,
      next_snapshot: LaboratorySnapshot,
    ): Promise<void> => {
      const previous_snapshot = snapshot_ref.current
      set_snapshot(next_snapshot)
      set_pending(field, true)

      try {
        const payload = await api_fetch<SettingsSnapshotPayload>('/api/settings/update', request)
        const next_settings_snapshot = normalize_settings_snapshot(payload)
        set_settings_snapshot(next_settings_snapshot)
        set_snapshot(build_laboratory_snapshot(next_settings_snapshot))
        set_refresh_error(null)
      } catch (error) {
        set_snapshot((current_snapshot) => {
          const reverted_snapshot = {
            ...current_snapshot,
          }

        if ('mtool_optimizer_enable' in request) {
          reverted_snapshot.mtool_optimizer_enable = previous_snapshot.mtool_optimizer_enable
        }

        return reverted_snapshot
      })

        if (error instanceof Error) {
          push_toast('error', error.message)
        } else {
          push_toast('error', t('laboratory_page.feedback.update_failed'))
        }
      } finally {
        set_pending(field, false)
      }
    },
    [push_toast, set_pending, set_settings_snapshot, t],
  )

  const update_mtool_optimizer_enable = useCallback(
    async (next_checked: boolean): Promise<void> => {
      const previous_snapshot = snapshot_ref.current

      if (is_task_busy || previous_snapshot.mtool_optimizer_enable === next_checked) {
        return
      }

      await commit_update('mtool_optimizer_enable', {
        mtool_optimizer_enable: next_checked,
      }, {
        ...previous_snapshot,
        mtool_optimizer_enable: next_checked,
      })
    },
    [commit_update, is_task_busy],
  )

  const value = useMemo<UseLaboratoryPageStateResult>(() => {
    return {
      snapshot,
      pending_state,
      refresh_error,
      is_refreshing,
      is_task_busy,
      refresh_snapshot,
      update_mtool_optimizer_enable,
    }
  }, [
    is_refreshing,
    is_task_busy,
    pending_state,
    refresh_error,
    refresh_snapshot,
    snapshot,
    update_mtool_optimizer_enable,
  ])

  return value
}
