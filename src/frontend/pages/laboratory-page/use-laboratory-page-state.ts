import { useCallback } from "react";

import { push_toast, run_modal_progress_toast } from "@frontend/app/feedback/desktop-toast";
import { format_project_settings_aligned_toast } from "@frontend/app/feedback/project-settings-alignment-feedback";
import { useI18n } from "@frontend/app/locale/locale-context";
import { useDesktopState, useRuntimeSnapshot } from "@frontend/app/state/use-desktop-state";
import { is_runtime_busy } from "@frontend/app/state/runtime-activity-store";
import { useSettingsEditor } from "@frontend/features/settings-editor/use-settings-editor";
import {
  build_laboratory_snapshot,
  type LaboratorySnapshot,
} from "@frontend/pages/laboratory-page/types";

const LABORATORY_PREFILTER_FIELDS = [
  "mtool_optimizer_enable",
  "skip_duplicate_source_text_enable",
] as const;

const LABORATORY_PENDING_FIELDS = [
  "prompt_enhancement_enable",
  ...LABORATORY_PREFILTER_FIELDS,
] as const;

type LaboratoryPendingField = (typeof LABORATORY_PENDING_FIELDS)[number];

type UseLaboratoryPageStateResult = {
  snapshot: LaboratorySnapshot;
  pending_state: Record<LaboratoryPendingField, boolean>;
  runtime_locked: boolean;
  update_prompt_enhancement_enable: (next_checked: boolean) => Promise<void>;
  update_mtool_optimizer_enable: (next_checked: boolean) => Promise<void>;
  update_skip_duplicate_source_text_enable: (next_checked: boolean) => Promise<void>;
};

/**
 * 组合通用设置编辑器与项目预过滤对齐流程，页面不直接拥有后端设置事实。
 */
export function useLaboratoryPageState(): UseLaboratoryPageStateResult {
  const { project_snapshot } = useDesktopState();
  const runtime_snapshot = useRuntimeSnapshot();

  const { t } = useI18n();
  const { snapshot, pending_state, commit_update } = useSettingsEditor({
    select_snapshot: build_laboratory_snapshot,
    pending_fields: LABORATORY_PENDING_FIELDS,
    refresh_error_key: "laboratory_page.feedback.refresh_failed",
    update_error_key: "laboratory_page.feedback.update_failed",
  });
  const runtime_locked = project_snapshot.loaded && is_runtime_busy(runtime_snapshot);

  const update_setting = useCallback(
    async (field: LaboratoryPendingField, next_checked: boolean): Promise<void> => {
      const affects_project = field !== "prompt_enhancement_enable";
      if ((affects_project && runtime_locked) || snapshot[field] === next_checked) return;
      const save = async (): Promise<void> => {
        const settings = await commit_update(field, { [field]: next_checked });
        if (settings !== null && affects_project && project_snapshot.loaded) {
          push_toast(
            "info",
            format_project_settings_aligned_toast({
              settings,
              changed_fields: { [field]: true },
              t,
            }),
          );
        }
      };
      if (affects_project && project_snapshot.loaded) {
        const message =
          field === "mtool_optimizer_enable"
            ? "laboratory_page.feedback.mtool_optimizer_loading_toast"
            : "laboratory_page.feedback.skip_duplicate_source_text_loading_toast";
        await run_modal_progress_toast({ message: t(message), task: save });
      } else {
        await save();
      }
    },
    [commit_update, project_snapshot.loaded, runtime_locked, snapshot, t],
  );

  return {
    snapshot,
    pending_state,
    runtime_locked,
    update_prompt_enhancement_enable: (value) => update_setting("prompt_enhancement_enable", value),
    update_mtool_optimizer_enable: (value) => update_setting("mtool_optimizer_enable", value),
    update_skip_duplicate_source_text_enable: (value) =>
      update_setting("skip_duplicate_source_text_enable", value),
  };
}
