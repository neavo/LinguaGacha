import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api_fetch } from "@frontend/app/desktop/desktop-api";
import type { SettingsSnapshotPayload } from "@frontend/app/state/desktop-state-context";
import { useDesktopState } from "@frontend/app/state/use-desktop-state";
import { is_project_write_locked } from "@frontend/app/state/task-snapshot-store";
import { useDesktopToast } from "@frontend/app/feedback/desktop-toast";
import { resolve_visible_error_message } from "@frontend/app/feedback/visible-error-message";
import { useI18n } from "@frontend/app/locale/locale-provider";
import {
  PRECEDING_LINES_THRESHOLD_MAX,
  PRECEDING_LINES_THRESHOLD_MIN,
  build_expert_settings_snapshot,
  type ExpertSettingsPendingField,
  type ExpertSettingsPendingState,
  type ExpertSettingsSnapshot,
} from "@frontend/pages/expert-settings-page/types";

type SettingsUpdateRequest = Record<string, unknown>;

type UseExpertSettingsStateResult = {
  snapshot: ExpertSettingsSnapshot;
  pending_state: ExpertSettingsPendingState;
  is_task_busy: boolean;
  refresh_snapshot: () => Promise<void>;
  update_preceding_lines_threshold: (next_value: number) => Promise<void>;
  update_clean_ruby: (next_checked: boolean) => Promise<void>;
  update_deduplication_in_bilingual: (next_checked: boolean) => Promise<void>;
  update_write_translated_name_fields_to_file: (next_checked: boolean) => Promise<void>;
  update_auto_process_prefix_suffix_preserved_text: (next_checked: boolean) => Promise<void>;
};

/**
 * 构造当前场景的标准初始数据。
 */
function create_pending_state(): ExpertSettingsPendingState {
  return {
    preceding_lines_threshold: false,
    clean_ruby: false,
    deduplication_in_bilingual: false,
    write_translated_name_fields_to_file: false,
    auto_process_prefix_suffix_preserved_text: false,
  };
}
function clamp_preceding_lines_threshold(next_value: number): number {
  return Math.min(
    PRECEDING_LINES_THRESHOLD_MAX,
    Math.max(PRECEDING_LINES_THRESHOLD_MIN, next_value),
  );
}
export function useExpertSettingsState(): UseExpertSettingsStateResult {
  const { settings_snapshot, apply_settings_snapshot, refresh_settings, task_snapshot } =
    useDesktopState();
  const { push_toast } = useDesktopToast();
  const { t } = useI18n();
  const is_task_busy = is_project_write_locked(task_snapshot);
  const [snapshot, set_snapshot] = useState<ExpertSettingsSnapshot>(() => {
    return build_expert_settings_snapshot(settings_snapshot);
  });
  const [pending_state, set_pending_state] = useState<ExpertSettingsPendingState>(() => {
    return create_pending_state();
  });
  const snapshot_ref = useRef<ExpertSettingsSnapshot>(snapshot);
  const context_snapshot = useMemo(() => {
    return build_expert_settings_snapshot(settings_snapshot);
  }, [settings_snapshot]);

  useEffect(() => {
    snapshot_ref.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    set_snapshot(context_snapshot);
  }, [context_snapshot]);

  const set_pending = useCallback(
    (field: ExpertSettingsPendingField, next_pending: boolean): void => {
      set_pending_state((previous_state) => {
        return {
          ...previous_state,
          [field]: next_pending,
        };
      });
    },
    [],
  );

  const refresh_snapshot = useCallback(async (): Promise<void> => {
    try {
      const next_settings_snapshot = await refresh_settings();
      set_snapshot(build_expert_settings_snapshot(next_settings_snapshot));
    } catch (error) {
      push_toast(
        "error",
        resolve_visible_error_message(error, t, t("expert_settings_page.feedback.refresh_failed")),
      );
    }
  }, [push_toast, refresh_settings, t]);

  useEffect(() => {
    void refresh_snapshot();
  }, [refresh_snapshot]);

  const commit_update = useCallback(
    async (
      field: ExpertSettingsPendingField,
      request: SettingsUpdateRequest,
      next_snapshot: ExpertSettingsSnapshot,
    ): Promise<void> => {
      if (is_task_busy) {
        return;
      }

      const previous_snapshot = snapshot_ref.current;
      set_snapshot(next_snapshot);
      set_pending(field, true);

      try {
        const payload = await api_fetch<SettingsSnapshotPayload>("/api/settings/update", request);
        const next_settings_snapshot = apply_settings_snapshot(payload);
        set_snapshot(build_expert_settings_snapshot(next_settings_snapshot));
      } catch (error) {
        set_snapshot((current_snapshot) => {
          const reverted_snapshot = {
            ...current_snapshot,
          };

          if ("preceding_lines_threshold" in request) {
            reverted_snapshot.preceding_lines_threshold =
              previous_snapshot.preceding_lines_threshold;
          }
          if ("clean_ruby" in request) {
            reverted_snapshot.clean_ruby = previous_snapshot.clean_ruby;
          }
          if ("deduplication_in_bilingual" in request) {
            reverted_snapshot.deduplication_in_bilingual =
              previous_snapshot.deduplication_in_bilingual;
          }
          if ("write_translated_name_fields_to_file" in request) {
            reverted_snapshot.write_translated_name_fields_to_file =
              previous_snapshot.write_translated_name_fields_to_file;
          }
          if ("auto_process_prefix_suffix_preserved_text" in request) {
            reverted_snapshot.auto_process_prefix_suffix_preserved_text =
              previous_snapshot.auto_process_prefix_suffix_preserved_text;
          }

          return reverted_snapshot;
        });

        push_toast(
          "error",
          resolve_visible_error_message(error, t, t("expert_settings_page.feedback.update_failed")),
        );
      } finally {
        set_pending(field, false);
      }
    },
    [apply_settings_snapshot, is_task_busy, push_toast, set_pending, t],
  );

  const update_preceding_lines_threshold = useCallback(
    async (next_value: number): Promise<void> => {
      const previous_snapshot = snapshot_ref.current;
      const normalized_threshold = clamp_preceding_lines_threshold(next_value);

      if (
        Number.isNaN(normalized_threshold) ||
        previous_snapshot.preceding_lines_threshold === normalized_threshold
      ) {
        return;
      }

      await commit_update(
        "preceding_lines_threshold",
        {
          preceding_lines_threshold: normalized_threshold,
        },
        {
          ...previous_snapshot,
          preceding_lines_threshold: normalized_threshold,
        },
      );
    },
    [commit_update],
  );

  const update_clean_ruby = useCallback(
    async (next_checked: boolean): Promise<void> => {
      const previous_snapshot = snapshot_ref.current;

      if (previous_snapshot.clean_ruby === next_checked) {
        return;
      }

      await commit_update(
        "clean_ruby",
        {
          clean_ruby: next_checked,
        },
        {
          ...previous_snapshot,
          clean_ruby: next_checked,
        },
      );
    },
    [commit_update],
  );

  const update_deduplication_in_bilingual = useCallback(
    async (next_checked: boolean): Promise<void> => {
      const previous_snapshot = snapshot_ref.current;

      if (previous_snapshot.deduplication_in_bilingual === next_checked) {
        return;
      }

      await commit_update(
        "deduplication_in_bilingual",
        {
          deduplication_in_bilingual: next_checked,
        },
        {
          ...previous_snapshot,
          deduplication_in_bilingual: next_checked,
        },
      );
    },
    [commit_update],
  );

  const update_write_translated_name_fields_to_file = useCallback(
    async (next_checked: boolean): Promise<void> => {
      const previous_snapshot = snapshot_ref.current;

      if (previous_snapshot.write_translated_name_fields_to_file === next_checked) {
        return;
      }

      await commit_update(
        "write_translated_name_fields_to_file",
        {
          write_translated_name_fields_to_file: next_checked,
        },
        {
          ...previous_snapshot,
          write_translated_name_fields_to_file: next_checked,
        },
      );
    },
    [commit_update],
  );

  const update_auto_process_prefix_suffix_preserved_text = useCallback(
    async (next_checked: boolean): Promise<void> => {
      const previous_snapshot = snapshot_ref.current;

      if (previous_snapshot.auto_process_prefix_suffix_preserved_text === next_checked) {
        return;
      }

      await commit_update(
        "auto_process_prefix_suffix_preserved_text",
        {
          auto_process_prefix_suffix_preserved_text: next_checked,
        },
        {
          ...previous_snapshot,
          auto_process_prefix_suffix_preserved_text: next_checked,
        },
      );
    },
    [commit_update],
  );

  const value = useMemo<UseExpertSettingsStateResult>(() => {
    return {
      snapshot,
      pending_state,
      is_task_busy,
      refresh_snapshot,
      update_preceding_lines_threshold,
      update_clean_ruby,
      update_deduplication_in_bilingual,
      update_write_translated_name_fields_to_file,
      update_auto_process_prefix_suffix_preserved_text,
    };
  }, [
    is_task_busy,
    pending_state,
    refresh_snapshot,
    snapshot,
    update_auto_process_prefix_suffix_preserved_text,
    update_clean_ruby,
    update_deduplication_in_bilingual,
    update_preceding_lines_threshold,
    update_write_translated_name_fields_to_file,
  ]);

  return value;
}
