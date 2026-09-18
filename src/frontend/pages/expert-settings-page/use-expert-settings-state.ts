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
  "clean_ruby",
  "deduplication_in_bilingual",
  "write_translated_name_fields_to_file",
] as const;

type ExpertSettingsPendingField = (typeof EXPERT_SETTINGS_PENDING_FIELDS)[number];

type UseExpertSettingsStateResult = {
  snapshot: ExpertSettingsSnapshot;
  pending_state: Record<ExpertSettingsPendingField, boolean>;
  update_preceding_lines_threshold: (next_value: number) => Promise<void>;
  update_clean_ruby: (next_checked: boolean) => Promise<void>;
  update_deduplication_in_bilingual: (next_checked: boolean) => Promise<void>;
  update_write_translated_name_fields_to_file: (next_checked: boolean) => Promise<void>;
};

/**
 * 输入框值在页面边界收敛到后端设置允许的区间。
 */
function clamp_preceding_lines_threshold(next_value: number): number {
  return Math.min(
    PRECEDING_LINES_THRESHOLD_MAX,
    Math.max(PRECEDING_LINES_THRESHOLD_MIN, next_value),
  );
}

/**
 * 将专家设置字段交给共享设置编辑器，保存后由各执行入口读取。
 */
export function useExpertSettingsState(): UseExpertSettingsStateResult {
  const { snapshot, pending_state, commit_update } = useSettingsEditor({
    select_snapshot: build_expert_settings_snapshot,
    pending_fields: EXPERT_SETTINGS_PENDING_FIELDS,
    refresh_error_key: "expert_settings_page.feedback.refresh_failed",
    update_error_key: "expert_settings_page.feedback.update_failed",
  });
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

  const update_clean_ruby = useCallback(
    async (next_checked: boolean): Promise<void> => {
      if (snapshot.clean_ruby !== next_checked) {
        await commit_update("clean_ruby", {
          clean_ruby: next_checked,
        });
      }
    },
    [commit_update, snapshot.clean_ruby],
  );

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
    update_clean_ruby,
    update_deduplication_in_bilingual,
    update_write_translated_name_fields_to_file,
  };
}
