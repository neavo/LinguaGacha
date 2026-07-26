import { useCallback } from "react";

import { useDesktopToast } from "@frontend/app/feedback/desktop-toast";
import { format_project_settings_aligned_toast } from "@frontend/app/feedback/project-settings-alignment-feedback";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-provider";
import type { SettingsSnapshot } from "@frontend/app/state/desktop-state-context";
import { useDesktopState } from "@frontend/app/state/use-desktop-state";
import { useSettingsEditor } from "@frontend/features/settings-editor/use-settings-editor";
import { apply_laboratory_prefilter_write } from "@frontend/pages/laboratory-page/laboratory-api-client";
import {
  build_laboratory_snapshot,
  type LaboratorySnapshot,
} from "@frontend/pages/laboratory-page/types";

const LABORATORY_PENDING_FIELDS = [
  "mtool_optimizer_enable",
  "skip_duplicate_source_text_enable",
] as const;

type LaboratoryPendingField = (typeof LABORATORY_PENDING_FIELDS)[number];

type UseLaboratoryPageStateResult = {
  snapshot: LaboratorySnapshot;
  pending_state: Record<LaboratoryPendingField, boolean>;
  is_task_busy: boolean;
  update_mtool_optimizer_enable: (next_checked: boolean) => Promise<void>;
  update_skip_duplicate_source_text_enable: (next_checked: boolean) => Promise<void>;
};

/**
 * 组合通用设置编辑器与项目预过滤对齐流程，页面不直接拥有后端设置事实。
 */
export function useLaboratoryPageState(): UseLaboratoryPageStateResult {
  const { task_snapshot, project_snapshot, commit_project_write } = useDesktopState();
  const { push_toast, run_modal_progress_toast } = useDesktopToast();
  const { t } = useI18n();
  const { snapshot, pending_state, commit_update } = useSettingsEditor({
    select_snapshot: build_laboratory_snapshot,
    pending_fields: LABORATORY_PENDING_FIELDS,
    refresh_error_key: "laboratory_page.feedback.refresh_failed",
    update_error_key: "laboratory_page.feedback.update_failed",
  });
  const is_task_busy = task_snapshot.busy;

  // 设置写入成功后再以权威快照刷新项目预过滤，避免提交前端临时状态。
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

  // 两个实验设置共用同一提交/补偿顺序，预过滤失败时把设置恢复到操作前值。
  const update_prefilter_setting = useCallback(
    async (
      field: LaboratoryPendingField,
      next_checked: boolean,
      loading_toast_key: LocaleKey,
    ): Promise<void> => {
      const previous_snapshot = snapshot;
      if (is_task_busy || previous_snapshot[field] === next_checked) {
        return;
      }

      try {
        await run_modal_progress_toast({
          message: t(loading_toast_key),
          task: async () => {
            const next_settings_snapshot = await commit_update(field, {
              [field]: next_checked,
            });
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
                    [field]: true,
                  },
                  t,
                }),
              );
            }
          },
        });
      } catch {
        const rollback_settings_snapshot = await commit_update(field, {
          [field]: previous_snapshot[field],
        });
        if (rollback_settings_snapshot !== null) {
          push_toast("error", t("laboratory_page.feedback.update_failed"));
        }
      }
    },
    [
      apply_prefilter_from_settings,
      commit_update,
      is_task_busy,
      project_snapshot.loaded,
      push_toast,
      run_modal_progress_toast,
      snapshot,
      t,
    ],
  );

  const update_mtool_optimizer_enable = useCallback(
    async (next_checked: boolean): Promise<void> => {
      await update_prefilter_setting(
        "mtool_optimizer_enable",
        next_checked,
        "laboratory_page.feedback.mtool_optimizer_loading_toast",
      );
    },
    [update_prefilter_setting],
  );

  const update_skip_duplicate_source_text_enable = useCallback(
    async (next_checked: boolean): Promise<void> => {
      await update_prefilter_setting(
        "skip_duplicate_source_text_enable",
        next_checked,
        "laboratory_page.feedback.skip_duplicate_source_text_loading_toast",
      );
    },
    [update_prefilter_setting],
  );

  return {
    snapshot,
    pending_state,
    is_task_busy,
    update_mtool_optimizer_enable,
    update_skip_duplicate_source_text_enable,
  };
}
