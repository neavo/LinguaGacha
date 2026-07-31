import { useCallback } from "react";

import { is_runtime_busy } from "@frontend/app/state/runtime-activity-store";
import { useDesktopState } from "@frontend/app/state/use-desktop-state";
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
  "auto_process_prefix_suffix_preserved_text",
] as const;

type ExpertSettingsPendingField = (typeof EXPERT_SETTINGS_PENDING_FIELDS)[number];

type UseExpertSettingsStateResult = {
  snapshot: ExpertSettingsSnapshot;
  pending_state: Record<ExpertSettingsPendingField, boolean>;
  runtime_locked: boolean;
  update_preceding_lines_threshold: (next_value: number) => Promise<void>;
  update_clean_ruby: (next_checked: boolean) => Promise<void>;
  update_deduplication_in_bilingual: (next_checked: boolean) => Promise<void>;
  update_write_translated_name_fields_to_file: (next_checked: boolean) => Promise<void>;
  update_auto_process_prefix_suffix_preserved_text: (next_checked: boolean) => Promise<void>;
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
 * 将专家设置字段映射到共享设置编辑器，并统一受项目写锁保护。
 */
export function useExpertSettingsState(): UseExpertSettingsStateResult {
  const { runtime_snapshot } = useDesktopState();
  const { snapshot, pending_state, commit_update } = useSettingsEditor({
    select_snapshot: build_expert_settings_snapshot,
    pending_fields: EXPERT_SETTINGS_PENDING_FIELDS,
    refresh_error_key: "expert_settings_page.feedback.refresh_failed",
    update_error_key: "expert_settings_page.feedback.update_failed",
  });
  const runtime_locked = is_runtime_busy(runtime_snapshot);

  // 所有专家设置共享同一写锁判断，避免各字段遗漏任务互斥。
  const commit_if_idle = useCallback(
    async (
      field: ExpertSettingsPendingField,
      patch: Partial<ExpertSettingsSnapshot>,
    ): Promise<void> => {
      if (!runtime_locked) {
        await commit_update(field, patch);
      }
    },
    [commit_update, runtime_locked],
  );

  const update_preceding_lines_threshold = useCallback(
    async (next_value: number): Promise<void> => {
      const normalized_threshold = clamp_preceding_lines_threshold(next_value);
      if (
        Number.isNaN(normalized_threshold) ||
        snapshot.preceding_lines_threshold === normalized_threshold
      ) {
        return;
      }

      await commit_if_idle("preceding_lines_threshold", {
        preceding_lines_threshold: normalized_threshold,
      });
    },
    [commit_if_idle, snapshot.preceding_lines_threshold],
  );

  const update_clean_ruby = useCallback(
    async (next_checked: boolean): Promise<void> => {
      if (snapshot.clean_ruby !== next_checked) {
        await commit_if_idle("clean_ruby", {
          clean_ruby: next_checked,
        });
      }
    },
    [commit_if_idle, snapshot.clean_ruby],
  );

  const update_deduplication_in_bilingual = useCallback(
    async (next_checked: boolean): Promise<void> => {
      if (snapshot.deduplication_in_bilingual !== next_checked) {
        await commit_if_idle("deduplication_in_bilingual", {
          deduplication_in_bilingual: next_checked,
        });
      }
    },
    [commit_if_idle, snapshot.deduplication_in_bilingual],
  );

  const update_write_translated_name_fields_to_file = useCallback(
    async (next_checked: boolean): Promise<void> => {
      if (snapshot.write_translated_name_fields_to_file !== next_checked) {
        await commit_if_idle("write_translated_name_fields_to_file", {
          write_translated_name_fields_to_file: next_checked,
        });
      }
    },
    [commit_if_idle, snapshot.write_translated_name_fields_to_file],
  );

  const update_auto_process_prefix_suffix_preserved_text = useCallback(
    async (next_checked: boolean): Promise<void> => {
      if (snapshot.auto_process_prefix_suffix_preserved_text !== next_checked) {
        await commit_if_idle("auto_process_prefix_suffix_preserved_text", {
          auto_process_prefix_suffix_preserved_text: next_checked,
        });
      }
    },
    [commit_if_idle, snapshot.auto_process_prefix_suffix_preserved_text],
  );

  return {
    snapshot,
    pending_state,
    runtime_locked,
    update_preceding_lines_threshold,
    update_clean_ruby,
    update_deduplication_in_bilingual,
    update_write_translated_name_fields_to_file,
    update_auto_process_prefix_suffix_preserved_text,
  };
}
