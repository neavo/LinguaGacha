import { useCallback } from "react";

import { api_fetch } from "@frontend/app/desktop/desktop-api";
import { useDesktopToast } from "@frontend/app/feedback/desktop-toast";
import { format_project_settings_aligned_toast } from "@frontend/app/feedback/project-settings-alignment-feedback";
import { resolve_visible_error_message } from "@frontend/app/feedback/visible-error-message";
import { useI18n } from "@frontend/app/locale/locale-provider";
import type { SettingsSnapshot } from "@frontend/app/state/desktop-state-context";
import { useDesktopState, useRuntimeSnapshot } from "@frontend/app/state/use-desktop-state";
import { is_runtime_busy } from "@frontend/app/state/runtime-activity-store";
import { apply_prefilter_settings_write } from "@frontend/features/settings-editor/prefilter-settings-write";
import { useSettingsEditor } from "@frontend/features/settings-editor/use-settings-editor";
import {
  REQUEST_TIMEOUT_MAX,
  REQUEST_TIMEOUT_MIN,
  build_basic_settings_snapshot,
  type BasicSettingsSnapshot,
  type ProjectSaveMode,
} from "@frontend/pages/basic-settings-page/types";

const BASIC_SETTINGS_PENDING_FIELDS = [
  "source_language",
  "target_language",
  "project_save_mode",
  "output_folder_open_on_finish",
  "request_timeout",
] as const;

type UseBasicSettingsStateResult = {
  snapshot: BasicSettingsSnapshot;
  pending_state: Record<(typeof BASIC_SETTINGS_PENDING_FIELDS)[number], boolean>;
  runtime_locked: boolean;
  update_source_language: (next_language: string) => Promise<void>;
  update_target_language: (next_language: string) => Promise<void>;
  update_project_save_mode: (next_mode: ProjectSaveMode) => Promise<void>;
  update_output_folder_open_on_finish: (next_checked: boolean) => Promise<void>;
  update_request_timeout: (next_value: number) => Promise<void>;
};

/**
 * 输入框值在页面边界收敛到后端设置允许的区间。
 */
function clamp_request_timeout(next_value: number): number {
  return Math.min(REQUEST_TIMEOUT_MAX, Math.max(REQUEST_TIMEOUT_MIN, next_value));
}

/**
 * 组合通用设置编辑器与项目预过滤对齐流程，页面不直接拥有后端设置事实。
 */
export function useBasicSettingsState(): UseBasicSettingsStateResult {
  const { settings_snapshot, project_snapshot, commit_project_write } = useDesktopState();
  const runtime_snapshot = useRuntimeSnapshot();
  const { push_toast, run_modal_progress_toast } = useDesktopToast();
  const { t } = useI18n();
  const { snapshot, pending_state, commit_update } = useSettingsEditor({
    select_snapshot: build_basic_settings_snapshot,
    pending_fields: BASIC_SETTINGS_PENDING_FIELDS,
    refresh_error_key: "basic_settings_page.feedback.refresh_failed",
    update_error_key: "basic_settings_page.feedback.update_failed",
  });
  const runtime_locked = is_runtime_busy(runtime_snapshot);

  // 预过滤写入失败回滚设置后，只恢复项目设置镜像，不再次执行失败的预过滤。
  const apply_project_settings_only_alignment = useCallback(
    async (next_settings_snapshot: SettingsSnapshot): Promise<void> => {
      if (!project_snapshot.loaded) {
        return;
      }

      await api_fetch("/api/workbench/settings-alignment/apply", {
        mode: "settings_only",
        project_settings: {
          source_language: next_settings_snapshot.source_language,
          target_language: next_settings_snapshot.target_language,
          mtool_optimizer_enable: next_settings_snapshot.mtool_optimizer_enable,
          skip_duplicate_source_text_enable:
            next_settings_snapshot.skip_duplicate_source_text_enable,
        },
      });
    },
    [project_snapshot.loaded],
  );

  // 设置写入成功后再用后端快照刷新项目预过滤，避免提交前端自行推导的事实。
  const apply_prefilter_from_settings = useCallback(
    async (next_settings_snapshot: SettingsSnapshot): Promise<void> => {
      if (!project_snapshot.loaded) {
        return;
      }

      await apply_prefilter_settings_write({
        operation: "basic-settings.prefilter_settings",
        settings: next_settings_snapshot,
        commit_project_write,
      });
    },
    [commit_project_write, project_snapshot.loaded],
  );

  // source_language 横跨设置与项目预过滤，两步失败时按相反顺序补偿。
  const rollback_source_language_after_prefilter_error = useCallback(
    async (
      previous_snapshot: BasicSettingsSnapshot,
      previous_settings_snapshot: SettingsSnapshot,
    ): Promise<void> => {
      const rollback_settings_snapshot = await commit_update("source_language", {
        source_language: previous_snapshot.source_language,
      });
      if (rollback_settings_snapshot === null) {
        return;
      }

      try {
        await apply_project_settings_only_alignment(previous_settings_snapshot);
      } catch (error) {
        push_toast(
          "error",
          resolve_visible_error_message(error, t, t("basic_settings_page.feedback.update_failed")),
        );
        return;
      }

      push_toast("error", t("basic_settings_page.feedback.update_failed"));
    },
    [apply_project_settings_only_alignment, commit_update, push_toast, t],
  );

  const update_source_language = useCallback(
    async (next_language: string): Promise<void> => {
      const previous_snapshot = snapshot;
      const previous_settings_snapshot = settings_snapshot;

      if (runtime_locked || previous_snapshot.source_language === next_language) {
        return;
      }

      try {
        await run_modal_progress_toast({
          message: t("basic_settings_page.feedback.source_language_loading_toast"),
          task: async () => {
            const next_settings_snapshot = await commit_update("source_language", {
              source_language: next_language,
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
                    source_language: true,
                  },
                  t,
                }),
              );
            }
          },
        });
      } catch {
        await rollback_source_language_after_prefilter_error(
          previous_snapshot,
          previous_settings_snapshot,
        );
      }
    },
    [
      apply_prefilter_from_settings,
      commit_update,
      runtime_locked,
      project_snapshot.loaded,
      push_toast,
      rollback_source_language_after_prefilter_error,
      run_modal_progress_toast,
      settings_snapshot,
      snapshot,
      t,
    ],
  );

  const update_target_language = useCallback(
    async (next_language: string): Promise<void> => {
      if (runtime_locked || snapshot.target_language === next_language) {
        return;
      }

      const next_settings_snapshot = await commit_update("target_language", {
        target_language: next_language,
      });
      if (next_settings_snapshot === null) {
        return;
      }

      await apply_project_settings_only_alignment(next_settings_snapshot);
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
              target_language: true,
            },
            t,
          }),
        );
      }
    },
    [
      apply_project_settings_only_alignment,
      commit_update,
      runtime_locked,
      project_snapshot.loaded,
      push_toast,
      snapshot.target_language,
      t,
    ],
  );

  const update_project_save_mode = useCallback(
    async (next_mode: ProjectSaveMode): Promise<void> => {
      if (snapshot.project_save_mode === next_mode) {
        return;
      }

      if (next_mode === "FIXED") {
        try {
          const result = await window.desktopApp.pickFixedProjectDirectory(
            snapshot.project_fixed_path,
          );
          const selected_path = result.paths[0] ?? "";
          if (result.canceled || selected_path === "") {
            return;
          }

          await commit_update("project_save_mode", {
            project_save_mode: next_mode,
            project_fixed_path: selected_path,
          });
        } catch (error) {
          push_toast(
            "error",
            resolve_visible_error_message(
              error,
              t,
              t("basic_settings_page.feedback.pick_directory_failed"),
            ),
          );
        }
        return;
      }

      await commit_update("project_save_mode", {
        project_save_mode: next_mode,
      });
    },
    [commit_update, push_toast, snapshot.project_fixed_path, snapshot.project_save_mode, t],
  );

  const update_output_folder_open_on_finish = useCallback(
    async (next_checked: boolean): Promise<void> => {
      if (snapshot.output_folder_open_on_finish === next_checked) {
        return;
      }

      await commit_update("output_folder_open_on_finish", {
        output_folder_open_on_finish: next_checked,
      });
    },
    [commit_update, snapshot.output_folder_open_on_finish],
  );

  const update_request_timeout = useCallback(
    async (next_value: number): Promise<void> => {
      const normalized_timeout = clamp_request_timeout(next_value);
      if (Number.isNaN(normalized_timeout) || snapshot.request_timeout === normalized_timeout) {
        return;
      }

      await commit_update("request_timeout", {
        request_timeout: normalized_timeout,
      });
    },
    [commit_update, snapshot.request_timeout],
  );

  return {
    snapshot,
    pending_state,
    runtime_locked,
    update_source_language,
    update_target_language,
    update_project_save_mode,
    update_output_folder_open_on_finish,
    update_request_timeout,
  };
}
