import type { SettingsSnapshot } from "@frontend/app/state/desktop-state-context";

export type LaboratorySnapshot = Pick<
  SettingsSnapshot,
  "prompt_enhancement_enable" | "mtool_optimizer_enable" | "skip_duplicate_source_text_enable"
>;

export function build_laboratory_snapshot(settings_snapshot: SettingsSnapshot): LaboratorySnapshot {
  return {
    prompt_enhancement_enable: settings_snapshot.prompt_enhancement_enable,
    mtool_optimizer_enable: settings_snapshot.mtool_optimizer_enable,
    skip_duplicate_source_text_enable: settings_snapshot.skip_duplicate_source_text_enable,
  };
}
