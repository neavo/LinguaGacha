import type { SettingsSnapshot } from '@/app/state/desktop-runtime-context'

export type LaboratoryPendingField =
  | 'mtool_optimizer_enable'

export type LaboratoryPendingState = Record<LaboratoryPendingField, boolean>

export type LaboratorySnapshot = Pick<
  SettingsSnapshot,
  | 'mtool_optimizer_enable'
>

export function build_laboratory_snapshot(settings_snapshot: SettingsSnapshot): LaboratorySnapshot {
  return {
    mtool_optimizer_enable: settings_snapshot.mtool_optimizer_enable,
  }
}
