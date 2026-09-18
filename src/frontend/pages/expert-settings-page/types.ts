import type { SettingsSnapshot } from "@frontend/app/state/desktop-state-context";

export const PRECEDING_LINES_THRESHOLD_MIN = 0;
export const PRECEDING_LINES_THRESHOLD_MAX = 9_999_999;

export type ExpertSettingsSnapshot = Pick<
  SettingsSnapshot,
  | "preceding_lines_threshold"
  | "clean_ruby"
  | "deduplication_in_bilingual"
  | "write_translated_name_fields_to_file"
>;

/** 将共享设置收窄为专家页面的编辑字段。 */
export function build_expert_settings_snapshot(
  settings_snapshot: SettingsSnapshot,
): ExpertSettingsSnapshot {
  return {
    preceding_lines_threshold: settings_snapshot.preceding_lines_threshold,
    clean_ruby: settings_snapshot.clean_ruby,
    deduplication_in_bilingual: settings_snapshot.deduplication_in_bilingual,
    write_translated_name_fields_to_file: settings_snapshot.write_translated_name_fields_to_file,
  };
}
