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
  PRECEDING_LINES_THRESHOLD_MAX,
  PRECEDING_LINES_THRESHOLD_MIN,
  build_expert_settings_snapshot,
  type ExpertSettingsPendingField,
  type ExpertSettingsPendingState,
  type ExpertSettingsSnapshot,
} from '@/pages/expert-settings-page/types'

type SettingsUpdateRequest = Record<string, unknown>

type UseExpertSettingsStateResult = {
  snapshot: ExpertSettingsSnapshot
  pending_state: ExpertSettingsPendingState
  refresh_error: string | null
  is_refreshing: boolean
  refresh_snapshot: () => Promise<void>
  update_preceding_lines_threshold: (next_value: number) => Promise<void>
  update_clean_ruby: (next_checked: boolean) => Promise<void>
  update_deduplication_in_trans: (next_checked: boolean) => Promise<void>
  update_deduplication_in_bilingual: (next_checked: boolean) => Promise<void>
  update_check_kana_residue: (next_checked: boolean) => Promise<void>
  update_check_hangeul_residue: (next_checked: boolean) => Promise<void>
  update_check_similarity: (next_checked: boolean) => Promise<void>
  update_write_translated_name_fields_to_file: (next_checked: boolean) => Promise<void>
  update_auto_process_prefix_suffix_preserved_text: (next_checked: boolean) => Promise<void>
}

function create_pending_state(): ExpertSettingsPendingState {
  return {
    preceding_lines_threshold: false,
    clean_ruby: false,
    deduplication_in_trans: false,
    deduplication_in_bilingual: false,
    check_kana_residue: false,
    check_hangeul_residue: false,
    check_similarity: false,
    write_translated_name_fields_to_file: false,
    auto_process_prefix_suffix_preserved_text: false,
  }
}

function clamp_preceding_lines_threshold(next_value: number): number {
  return Math.min(PRECEDING_LINES_THRESHOLD_MAX, Math.max(PRECEDING_LINES_THRESHOLD_MIN, next_value))
}

export function useExpertSettingsState(): UseExpertSettingsStateResult {
  const {
    settings_snapshot,
    set_settings_snapshot,
    refresh_settings,
  } = useDesktopRuntime()
  const { push_toast } = useDesktopToast()
  const { t } = useI18n()
  const [snapshot, set_snapshot] = useState<ExpertSettingsSnapshot>(() => {
    return build_expert_settings_snapshot(settings_snapshot)
  })
  const [pending_state, set_pending_state] = useState<ExpertSettingsPendingState>(() => {
    return create_pending_state()
  })
  const [refresh_error, set_refresh_error] = useState<string | null>(null)
  const [is_refreshing, set_is_refreshing] = useState<boolean>(false)
  const snapshot_ref = useRef<ExpertSettingsSnapshot>(snapshot)
  const context_snapshot = useMemo(() => {
    return build_expert_settings_snapshot(settings_snapshot)
  }, [settings_snapshot])

  useEffect(() => {
    snapshot_ref.current = snapshot
  }, [snapshot])

  useEffect(() => {
    set_snapshot(context_snapshot)
  }, [context_snapshot])

  const set_pending = useCallback((field: ExpertSettingsPendingField, next_pending: boolean): void => {
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
      set_snapshot(build_expert_settings_snapshot(next_settings_snapshot))
      set_refresh_error(null)
    } catch (error) {
      if (error instanceof Error) {
        set_refresh_error(error.message)
      } else {
        set_refresh_error(t('expert_settings_page.feedback.refresh_failed'))
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
      field: ExpertSettingsPendingField,
      request: SettingsUpdateRequest,
      next_snapshot: ExpertSettingsSnapshot,
    ): Promise<void> => {
      const previous_snapshot = snapshot_ref.current
      set_snapshot(next_snapshot)
      set_pending(field, true)

      try {
        const payload = await api_fetch<SettingsSnapshotPayload>('/api/settings/update', request)
        const next_settings_snapshot = normalize_settings_snapshot(payload)
        set_settings_snapshot(next_settings_snapshot)
        set_snapshot(build_expert_settings_snapshot(next_settings_snapshot))
        set_refresh_error(null)
      } catch (error) {
        set_snapshot((current_snapshot) => {
          const reverted_snapshot = {
            ...current_snapshot,
          }

          if ('preceding_lines_threshold' in request) {
            reverted_snapshot.preceding_lines_threshold = previous_snapshot.preceding_lines_threshold
          }
          if ('clean_ruby' in request) {
            reverted_snapshot.clean_ruby = previous_snapshot.clean_ruby
          }
          if ('deduplication_in_trans' in request) {
            reverted_snapshot.deduplication_in_trans = previous_snapshot.deduplication_in_trans
          }
          if ('deduplication_in_bilingual' in request) {
            reverted_snapshot.deduplication_in_bilingual = previous_snapshot.deduplication_in_bilingual
          }
          if ('check_kana_residue' in request) {
            reverted_snapshot.check_kana_residue = previous_snapshot.check_kana_residue
          }
          if ('check_hangeul_residue' in request) {
            reverted_snapshot.check_hangeul_residue = previous_snapshot.check_hangeul_residue
          }
          if ('check_similarity' in request) {
            reverted_snapshot.check_similarity = previous_snapshot.check_similarity
          }
          if ('write_translated_name_fields_to_file' in request) {
            reverted_snapshot.write_translated_name_fields_to_file = previous_snapshot.write_translated_name_fields_to_file
          }
          if ('auto_process_prefix_suffix_preserved_text' in request) {
            reverted_snapshot.auto_process_prefix_suffix_preserved_text = previous_snapshot.auto_process_prefix_suffix_preserved_text
          }

          return reverted_snapshot
        })

        if (error instanceof Error) {
          push_toast('error', error.message)
        } else {
          push_toast('error', t('expert_settings_page.feedback.update_failed'))
        }
      } finally {
        set_pending(field, false)
      }
    },
    [push_toast, set_pending, set_settings_snapshot, t],
  )

  const update_preceding_lines_threshold = useCallback(
    async (next_value: number): Promise<void> => {
      const previous_snapshot = snapshot_ref.current
      const normalized_threshold = clamp_preceding_lines_threshold(next_value)

      if (Number.isNaN(normalized_threshold) || previous_snapshot.preceding_lines_threshold === normalized_threshold) {
        return
      }

      await commit_update('preceding_lines_threshold', {
        preceding_lines_threshold: normalized_threshold,
      }, {
        ...previous_snapshot,
        preceding_lines_threshold: normalized_threshold,
      })
    },
    [commit_update],
  )

  const update_clean_ruby = useCallback(
    async (next_checked: boolean): Promise<void> => {
      const previous_snapshot = snapshot_ref.current

      if (previous_snapshot.clean_ruby === next_checked) {
        return
      }

      await commit_update('clean_ruby', {
        clean_ruby: next_checked,
      }, {
        ...previous_snapshot,
        clean_ruby: next_checked,
      })
    },
    [commit_update],
  )

  const update_deduplication_in_trans = useCallback(
    async (next_checked: boolean): Promise<void> => {
      const previous_snapshot = snapshot_ref.current

      if (previous_snapshot.deduplication_in_trans === next_checked) {
        return
      }

      await commit_update('deduplication_in_trans', {
        deduplication_in_trans: next_checked,
      }, {
        ...previous_snapshot,
        deduplication_in_trans: next_checked,
      })
    },
    [commit_update],
  )

  const update_deduplication_in_bilingual = useCallback(
    async (next_checked: boolean): Promise<void> => {
      const previous_snapshot = snapshot_ref.current

      if (previous_snapshot.deduplication_in_bilingual === next_checked) {
        return
      }

      await commit_update('deduplication_in_bilingual', {
        deduplication_in_bilingual: next_checked,
      }, {
        ...previous_snapshot,
        deduplication_in_bilingual: next_checked,
      })
    },
    [commit_update],
  )

  const update_check_kana_residue = useCallback(
    async (next_checked: boolean): Promise<void> => {
      const previous_snapshot = snapshot_ref.current

      if (previous_snapshot.check_kana_residue === next_checked) {
        return
      }

      await commit_update('check_kana_residue', {
        check_kana_residue: next_checked,
      }, {
        ...previous_snapshot,
        check_kana_residue: next_checked,
      })
    },
    [commit_update],
  )

  const update_check_hangeul_residue = useCallback(
    async (next_checked: boolean): Promise<void> => {
      const previous_snapshot = snapshot_ref.current

      if (previous_snapshot.check_hangeul_residue === next_checked) {
        return
      }

      await commit_update('check_hangeul_residue', {
        check_hangeul_residue: next_checked,
      }, {
        ...previous_snapshot,
        check_hangeul_residue: next_checked,
      })
    },
    [commit_update],
  )

  const update_check_similarity = useCallback(
    async (next_checked: boolean): Promise<void> => {
      const previous_snapshot = snapshot_ref.current

      if (previous_snapshot.check_similarity === next_checked) {
        return
      }

      await commit_update('check_similarity', {
        check_similarity: next_checked,
      }, {
        ...previous_snapshot,
        check_similarity: next_checked,
      })
    },
    [commit_update],
  )

  const update_write_translated_name_fields_to_file = useCallback(
    async (next_checked: boolean): Promise<void> => {
      const previous_snapshot = snapshot_ref.current

      if (previous_snapshot.write_translated_name_fields_to_file === next_checked) {
        return
      }

      await commit_update('write_translated_name_fields_to_file', {
        write_translated_name_fields_to_file: next_checked,
      }, {
        ...previous_snapshot,
        write_translated_name_fields_to_file: next_checked,
      })
    },
    [commit_update],
  )

  const update_auto_process_prefix_suffix_preserved_text = useCallback(
    async (next_checked: boolean): Promise<void> => {
      const previous_snapshot = snapshot_ref.current

      if (previous_snapshot.auto_process_prefix_suffix_preserved_text === next_checked) {
        return
      }

      await commit_update('auto_process_prefix_suffix_preserved_text', {
        auto_process_prefix_suffix_preserved_text: next_checked,
      }, {
        ...previous_snapshot,
        auto_process_prefix_suffix_preserved_text: next_checked,
      })
    },
    [commit_update],
  )

  const value = useMemo<UseExpertSettingsStateResult>(() => {
    return {
      snapshot,
      pending_state,
      refresh_error,
      is_refreshing,
      refresh_snapshot,
      update_preceding_lines_threshold,
      update_clean_ruby,
      update_deduplication_in_trans,
      update_deduplication_in_bilingual,
      update_check_kana_residue,
      update_check_hangeul_residue,
      update_check_similarity,
      update_write_translated_name_fields_to_file,
      update_auto_process_prefix_suffix_preserved_text,
    }
  }, [
    is_refreshing,
    pending_state,
    refresh_error,
    refresh_snapshot,
    snapshot,
    update_auto_process_prefix_suffix_preserved_text,
    update_check_hangeul_residue,
    update_check_kana_residue,
    update_check_similarity,
    update_clean_ruby,
    update_deduplication_in_bilingual,
    update_deduplication_in_trans,
    update_preceding_lines_threshold,
    update_write_translated_name_fields_to_file,
  ])

  return value
}

