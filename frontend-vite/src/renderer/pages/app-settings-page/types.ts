import type { SettingsSnapshot } from '@/app/state/desktop-runtime-context'

export type AppSettingsSnapshot = {
  expert_mode: boolean
}

export type AppSettingsPendingState = {
  expert_mode: boolean
}

export type AppSettingsPendingField = keyof AppSettingsPendingState

export function create_app_settings_pending_state(): AppSettingsPendingState {
  return {
    expert_mode: false,
  }
}

export function build_app_settings_snapshot(settings_snapshot: SettingsSnapshot): AppSettingsSnapshot {
  return {
    expert_mode: settings_snapshot.expert_mode,
  }
}
