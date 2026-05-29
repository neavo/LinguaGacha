import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api_fetch } from "@frontend/app/desktop/desktop-api";
import { apply_laboratory_prefilter_write } from "@frontend/pages/laboratory-page/laboratory-api-client";
import { format_project_settings_aligned_toast } from "@frontend/app/feedback/project-settings-alignment-feedback";
import type {
  SettingsSnapshot,
  SettingsSnapshotPayload,
} from "@frontend/app/state/desktop-state-context";
import { useDesktopState } from "@frontend/app/state/use-desktop-state";
import { useDesktopToast } from "@frontend/app/feedback/desktop-toast";
import { resolve_visible_error_message } from "@frontend/app/feedback/visible-error-message";
import { useI18n } from "@frontend/app/locale/locale-provider";
import {
  build_laboratory_snapshot,
  type LaboratoryPendingField,
  type LaboratoryPendingState,
  type LaboratorySnapshot,
} from "@frontend/pages/laboratory-page/types";

type SettingsUpdateRequest = Record<string, unknown>;

type UseLaboratoryPageStateResult = {
  snapshot: LaboratorySnapshot;
  pending_state: LaboratoryPendingState;
  is_task_busy: boolean;
  update_mtool_optimizer_enable: (next_checked: boolean) => Promise<void>;
  update_skip_duplicate_source_text_enable: (next_checked: boolean) => Promise<void>;
};

// create_pending_state 构造跨层载荷，保证字段形状在一个入口维护。
/**
 * 构建当前场景的稳定结果。
 */
function create_pending_state(): LaboratoryPendingState {
  return {
    mtool_optimizer_enable: false,
    skip_duplicate_source_text_enable: false,
  };
}

// useLaboratoryPageState 封装当前模块的共享逻辑，避免重复实现同一维护规则。
export function useLaboratoryPageState(): UseLaboratoryPageStateResult {
  const {
    settings_snapshot,
    task_snapshot,
    project_snapshot,
    apply_settings_snapshot,
    commit_project_write,
    refresh_settings,
  } = useDesktopState();
  const { push_toast, run_modal_progress_toast } = useDesktopToast();
  const { t } = useI18n();
  const [snapshot, set_snapshot] = useState<LaboratorySnapshot>(() => {
    return build_laboratory_snapshot(settings_snapshot);
  });
  const [pending_state, set_pending_state] = useState<LaboratoryPendingState>(() => {
    return create_pending_state();
  });
  const snapshot_ref = useRef<LaboratorySnapshot>(snapshot);
  const context_snapshot = useMemo(() => {
    return build_laboratory_snapshot(settings_snapshot);
  }, [settings_snapshot]);

  useEffect(() => {
    snapshot_ref.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    set_snapshot(context_snapshot);
  }, [context_snapshot]);

  const is_task_busy = task_snapshot.busy;

  const set_pending = useCallback((field: LaboratoryPendingField, next_pending: boolean): void => {
    set_pending_state((previous_state) => {
      return {
        ...previous_state,
        [field]: next_pending,
      };
    });
  }, []);

  const refresh_snapshot = useCallback(async (): Promise<void> => {
    try {
      const next_settings_snapshot = await refresh_settings();
      set_snapshot(build_laboratory_snapshot(next_settings_snapshot));
    } catch (error) {
      push_toast(
        "error",
        resolve_visible_error_message(error, t, t("laboratory_page.feedback.refresh_failed")),
      );
    }
  }, [push_toast, refresh_settings, t]);

  useEffect(() => {
    void refresh_snapshot();
  }, [refresh_snapshot]);

  const commit_update = useCallback(
    async (
      field: LaboratoryPendingField,
      request: SettingsUpdateRequest,
      next_snapshot: LaboratorySnapshot,
    ): Promise<SettingsSnapshot | null> => {
      const previous_snapshot = snapshot_ref.current;
      set_snapshot(next_snapshot);
      set_pending(field, true);

      try {
        const payload = await api_fetch<SettingsSnapshotPayload>("/api/settings/update", request);
        const next_settings_snapshot = apply_settings_snapshot(payload);
        set_snapshot(build_laboratory_snapshot(next_settings_snapshot));
        return next_settings_snapshot;
      } catch (error) {
        set_snapshot((current_snapshot) => {
          const reverted_snapshot = {
            ...current_snapshot,
          };

          if ("mtool_optimizer_enable" in request) {
            reverted_snapshot.mtool_optimizer_enable = previous_snapshot.mtool_optimizer_enable;
          }
          if ("skip_duplicate_source_text_enable" in request) {
            reverted_snapshot.skip_duplicate_source_text_enable =
              previous_snapshot.skip_duplicate_source_text_enable;
          }

          return reverted_snapshot;
        });

        push_toast(
          "error",
          resolve_visible_error_message(error, t, t("laboratory_page.feedback.update_failed")),
        );
        return null;
      } finally {
        set_pending(field, false);
      }
    },
    [apply_settings_snapshot, push_toast, set_pending, t],
  );

  const apply_prefilter_from_settings = useCallback(
    async (next_settings_snapshot: SettingsSnapshot): Promise<void> => {
      if (!project_snapshot.loaded) {
        return;
      }

      await apply_laboratory_prefilter_write({
        source_language: next_settings_snapshot.source_language,
        target_language: next_settings_snapshot.target_language,
        mtool_optimizer_enable: next_settings_snapshot.mtool_optimizer_enable,
        skip_duplicate_source_text_enable: next_settings_snapshot.skip_duplicate_source_text_enable,
        commit_project_write,
      });
    },
    [commit_project_write, project_snapshot.loaded],
  );

  const rollback_prefilter_setting_after_prefilter_error = useCallback(
    async (
      field: LaboratoryPendingField,
      request: SettingsUpdateRequest,
      previous_snapshot: LaboratorySnapshot,
    ): Promise<void> => {
      const rollback_settings_snapshot = await commit_update(field, request, previous_snapshot);
      if (rollback_settings_snapshot === null) {
        return;
      }

      push_toast("error", t("laboratory_page.feedback.update_failed"));
    },
    [commit_update, push_toast, t],
  );

  const update_mtool_optimizer_enable = useCallback(
    async (next_checked: boolean): Promise<void> => {
      const previous_snapshot = snapshot_ref.current;

      if (is_task_busy || previous_snapshot.mtool_optimizer_enable === next_checked) {
        return;
      }

      try {
        await run_modal_progress_toast({
          message: t("laboratory_page.feedback.mtool_optimizer_loading_toast"),
          task: async () => {
            const next_settings_snapshot = await commit_update(
              "mtool_optimizer_enable",
              {
                mtool_optimizer_enable: next_checked,
              },
              {
                ...previous_snapshot,
                mtool_optimizer_enable: next_checked,
              },
            );

            if (next_settings_snapshot === null) {
              return;
            }

            await apply_prefilter_from_settings(next_settings_snapshot);
            if (project_snapshot.loaded) {
              push_toast(
                "info",
                format_project_settings_aligned_toast({
                  settings: {
                    source_language: next_settings_snapshot.source_language,
                    target_language: next_settings_snapshot.target_language,
                    mtool_optimizer_enable: next_settings_snapshot.mtool_optimizer_enable,
                    skip_duplicate_source_text_enable:
                      next_settings_snapshot.skip_duplicate_source_text_enable,
                  },
                  changed_fields: {
                    mtool_optimizer_enable: true,
                  },
                  t,
                }),
              );
            }
          },
        });
      } catch {
        await rollback_prefilter_setting_after_prefilter_error(
          "mtool_optimizer_enable",
          {
            mtool_optimizer_enable: previous_snapshot.mtool_optimizer_enable,
          },
          previous_snapshot,
        );
      }
    },
    [
      apply_prefilter_from_settings,
      commit_update,
      is_task_busy,
      project_snapshot.loaded,
      rollback_prefilter_setting_after_prefilter_error,
      run_modal_progress_toast,
      t,
    ],
  );

  const update_skip_duplicate_source_text_enable = useCallback(
    async (next_checked: boolean): Promise<void> => {
      const previous_snapshot = snapshot_ref.current;

      if (is_task_busy || previous_snapshot.skip_duplicate_source_text_enable === next_checked) {
        return;
      }

      try {
        await run_modal_progress_toast({
          message: t("laboratory_page.feedback.skip_duplicate_source_text_loading_toast"),
          task: async () => {
            const next_settings_snapshot = await commit_update(
              "skip_duplicate_source_text_enable",
              {
                skip_duplicate_source_text_enable: next_checked,
              },
              {
                ...previous_snapshot,
                skip_duplicate_source_text_enable: next_checked,
              },
            );

            if (next_settings_snapshot === null) {
              return;
            }

            await apply_prefilter_from_settings(next_settings_snapshot);
            if (project_snapshot.loaded) {
              push_toast(
                "info",
                format_project_settings_aligned_toast({
                  settings: {
                    source_language: next_settings_snapshot.source_language,
                    target_language: next_settings_snapshot.target_language,
                    mtool_optimizer_enable: next_settings_snapshot.mtool_optimizer_enable,
                    skip_duplicate_source_text_enable:
                      next_settings_snapshot.skip_duplicate_source_text_enable,
                  },
                  changed_fields: {
                    skip_duplicate_source_text_enable: true,
                  },
                  t,
                }),
              );
            }
          },
        });
      } catch {
        await rollback_prefilter_setting_after_prefilter_error(
          "skip_duplicate_source_text_enable",
          {
            skip_duplicate_source_text_enable: previous_snapshot.skip_duplicate_source_text_enable,
          },
          previous_snapshot,
        );
      }
    },
    [
      apply_prefilter_from_settings,
      commit_update,
      is_task_busy,
      project_snapshot.loaded,
      push_toast,
      rollback_prefilter_setting_after_prefilter_error,
      run_modal_progress_toast,
      t,
    ],
  );

  const value = useMemo<UseLaboratoryPageStateResult>(() => {
    return {
      snapshot,
      pending_state,
      is_task_busy,
      update_mtool_optimizer_enable,
      update_skip_duplicate_source_text_enable,
    };
  }, [
    is_task_busy,
    pending_state,
    snapshot,
    update_mtool_optimizer_enable,
    update_skip_duplicate_source_text_enable,
  ]);

  return value;
}
