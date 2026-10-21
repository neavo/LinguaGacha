import { useCallback } from "react";

import { useSettingsEditor } from "@frontend/features/settings-editor/use-settings-editor";
import {
  PRECEDING_LINES_THRESHOLD_MAX,
  PRECEDING_LINES_THRESHOLD_MIN,
  build_expert_settings_snapshot,
  type ExpertSettingsSnapshot,
} from "@frontend/pages/expert-settings-page/types";

const EXPERT_SETTINGS_PENDING_FIELDS = [
  "preceding_lines_threshold",
  "deduplication_in_bilingual",
  "write_translated_name_fields_to_file",
] as const;

type ExpertSettingsPendingField = (typeof EXPERT_SETTINGS_PENDING_FIELDS)[number];

type UseExpertSettingsStateResult = {
  snapshot: ExpertSettingsSnapshot;
  pending_state: Record<ExpertSettingsPendingField, boolean>;
  update_preceding_lines_threshold: (next_value: number) => Promise<void>;
  update_deduplication_in_bilingual: (next_checked: boolean) => Promise<void>;
  update_write_translated_name_fields_to_file: (next_checked: boolean) => Promise<void>;
};

/** 将输入值限制在后端设置允许的区间。 */
function clamp_preceding_lines_threshold(next_value: number): number {
  return Math.min(
    PRECEDING_LINES_THRESHOLD_MAX,
    Math.max(PRECEDING_LINES_THRESHOLD_MIN, next_value),
  );
}

/** 共享设置编辑器负责保存专家设置并同步快照。 */
export function useExpertSettingsState(): UseExpertSettingsStateResult {
  const { snapshot, pending_state, commit_update } = useSettingsEditor({
    select_snapshot: build_expert_settings_snapshot,
    pending_fields: EXPERT_SETTINGS_PENDING_FIELDS,
  });
  /** 提交有效且已变化的阈值。 */
  const update_preceding_lines_threshold = useCallback(
    async (next_value: number): Promise<void> => {
      const normalized_threshold = clamp_preceding_lines_threshold(next_value);
      if (
        Number.isNaN(normalized_threshold) ||
        snapshot.preceding_lines_threshold === normalized_threshold
      ) {
        return;
      }

      await commit_update("preceding_lines_threshold", {
        preceding_lines_threshold: normalized_threshold,
      });
    },
    [commit_update, snapshot.preceding_lines_threshold],
  );

  /** 双语去重选项变化后才提交。 */
  const update_deduplication_in_bilingual = useCallback(
    async (next_checked: boolean): Promise<void> => {
      if (snapshot.deduplication_in_bilingual !== next_checked) {
        await commit_update("deduplication_in_bilingual", {
          deduplication_in_bilingual: next_checked,
        });
      }
    },
    [commit_update, snapshot.deduplication_in_bilingual],
  );

  /** 角色译名导出选项变化后才提交。 */
  const update_write_translated_name_fields_to_file = useCallback(
    async (next_checked: boolean): Promise<void> => {
      if (snapshot.write_translated_name_fields_to_file !== next_checked) {
        await commit_update("write_translated_name_fields_to_file", {
          write_translated_name_fields_to_file: next_checked,
        });
      }
    },
    [commit_update, snapshot.write_translated_name_fields_to_file],
  );

  return {
    snapshot,
    pending_state,
    update_preceding_lines_threshold,
    update_deduplication_in_bilingual,
    update_write_translated_name_fields_to_file,
  };
}
