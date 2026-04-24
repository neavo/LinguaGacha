import type { SettingsSnapshot } from "@/app/runtime/desktop/desktop-runtime-context";

export const PRECEDING_LINES_THRESHOLD_MIN = 0;
export const PRECEDING_LINES_THRESHOLD_MAX = 9_999_999;

export type ExpertSettingsPendingField =
  | "preceding_lines_threshold"
  | "clean_ruby"
  | "deduplication_in_trans"
  | "deduplication_in_bilingual"
  | "check_kana_residue"
  | "check_hangeul_residue"
  | "check_similarity"
  | "write_translated_name_fields_to_file"
  | "auto_process_prefix_suffix_preserved_text";

export type ExpertSettingsPendingState = Record<ExpertSettingsPendingField, boolean>;

export type ExpertSettingsSnapshot = Pick<
  SettingsSnapshot,
  | "preceding_lines_threshold"
  | "clean_ruby"
  | "deduplication_in_trans"
  | "deduplication_in_bilingual"
  | "check_kana_residue"
  | "check_hangeul_residue"
  | "check_similarity"
  | "write_translated_name_fields_to_file"
  | "auto_process_prefix_suffix_preserved_text"
>;

export function build_expert_settings_snapshot(
  settings_snapshot: SettingsSnapshot,
): ExpertSettingsSnapshot {
  return {
    preceding_lines_threshold: settings_snapshot.preceding_lines_threshold,
    clean_ruby: settings_snapshot.clean_ruby,
    deduplication_in_trans: settings_snapshot.deduplication_in_trans,
    deduplication_in_bilingual: settings_snapshot.deduplication_in_bilingual,
    check_kana_residue: settings_snapshot.check_kana_residue,
    check_hangeul_residue: settings_snapshot.check_hangeul_residue,
    check_similarity: settings_snapshot.check_similarity,
    write_translated_name_fields_to_file: settings_snapshot.write_translated_name_fields_to_file,
    auto_process_prefix_suffix_preserved_text:
      settings_snapshot.auto_process_prefix_suffix_preserved_text,
  };
}
