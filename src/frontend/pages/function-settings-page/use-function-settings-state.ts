import {
  normalize_context_lines_threshold,
  type ProjectSaveMode,
  type TranslationSaveMode,
} from "@domain/setting";
import { push_error_toast } from "@frontend/app/feedback/desktop-toast";
import { useCallback, useState } from "react";

import { useI18n } from "@frontend/app/locale/locale-context";
import { useSettingsEditor } from "@frontend/features/settings-editor/use-settings-editor";
import {
  REQUEST_TIMEOUT_MAX,
  REQUEST_TIMEOUT_MIN,
  build_function_settings_snapshot,
  type FunctionSettingsSnapshot,
} from "@frontend/pages/function-settings-page/types";

const FUNCTION_SETTINGS_PENDING_FIELDS = [
  "preceding_lines_threshold",
  "following_lines_threshold",
  "project_save_mode",
  "translation_save_mode",
  "output_folder_open_on_finish",
  "request_timeout",
] as const;

type UseFunctionSettingsStateResult = {
  snapshot: FunctionSettingsSnapshot;
  pending_state: Record<(typeof FUNCTION_SETTINGS_PENDING_FIELDS)[number], boolean>;
  update_project_save_mode: (next_mode: ProjectSaveMode) => Promise<void>;
  update_translation_save_mode: (next_mode: TranslationSaveMode) => Promise<void>;
  choosing_directory: Record<"project_save_mode" | "translation_save_mode", boolean>;
  update_output_folder_open_on_finish: (next_checked: boolean) => Promise<void>;
  update_preceding_lines_threshold: (next_value: number) => Promise<void>;
  update_following_lines_threshold: (next_value: number) => Promise<void>;
  update_request_timeout: (next_value: number) => Promise<void>;
};

/**
 * 输入框值在页面边界收敛到后端设置允许的区间。
 */
function clamp_request_timeout(next_value: number): number {
  return Math.min(REQUEST_TIMEOUT_MAX, Math.max(REQUEST_TIMEOUT_MIN, next_value));
}

/**
 * 组合应用设置编辑器与目录选择，页面不直接拥有后端设置事实。
 */
export function useFunctionSettingsState(): UseFunctionSettingsStateResult {
  const { t } = useI18n();
  const { snapshot, pending_state, commit_update } = useSettingsEditor({
    select_snapshot: build_function_settings_snapshot,
    pending_fields: FUNCTION_SETTINGS_PENDING_FIELDS,
  });
  // 原生目录选择的等待状态独立于设置保存，两行分别维护。
  const [choosing_directory, set_choosing_directory] = useState({
    project_save_mode: false,
    translation_save_mode: false,
  });
  /** 两类保存位置共用目录选择流程，模式与路径在同一次请求中提交。 */
  const update_save_mode = useCallback(
    async (
      field: "project_save_mode" | "translation_save_mode",
      next_mode: ProjectSaveMode | TranslationSaveMode,
    ): Promise<void> => {
      if (snapshot[field] === next_mode) return;
      const path_field =
        field === "project_save_mode" ? "project_fixed_path" : "translation_fixed_path";
      if (next_mode === "FIXED") {
        let selected_path: string;
        set_choosing_directory((previous) => ({ ...previous, [field]: true }));
        try {
          const result = await window.desktopApp.pickDirectory(snapshot[path_field]);
          if (result.canceled || !result.paths[0]) return;
          selected_path = result.paths[0];
        } catch (error) {
          push_error_toast(t("function_settings_page.feedback.pick_directory_failed"), error);
          return;
        } finally {
          set_choosing_directory((previous) => ({ ...previous, [field]: false }));
        }
        await commit_update(field, { [field]: next_mode, [path_field]: selected_path });
        return;
      }
      await commit_update(field, { [field]: next_mode });
    },
    [commit_update, snapshot, t],
  );

  /** 开关值变化后交给共享编辑器保存。 */
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

  /** 收敛超时输入并跳过无效值与重复提交。 */
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

  /** 前后文共用领域计数规则，各字段独立保存。 */
  const update_context_threshold = useCallback(
    async (
      field: "preceding_lines_threshold" | "following_lines_threshold",
      value: number,
    ): Promise<void> => {
      const normalized = normalize_context_lines_threshold(value);
      if (snapshot[field] === normalized) return;
      await commit_update(field, { [field]: normalized });
    },
    [commit_update, snapshot],
  );

  return {
    snapshot,
    pending_state,
    choosing_directory,
    update_project_save_mode: (mode) => update_save_mode("project_save_mode", mode),
    update_translation_save_mode: (mode) => update_save_mode("translation_save_mode", mode),
    update_output_folder_open_on_finish,
    update_request_timeout,
    update_preceding_lines_threshold: (value) =>
      update_context_threshold("preceding_lines_threshold", value),
    update_following_lines_threshold: (value) =>
      update_context_threshold("following_lines_threshold", value),
  };
}
