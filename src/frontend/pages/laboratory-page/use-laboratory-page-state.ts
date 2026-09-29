import { useCallback } from "react";
import { PROJECT_SETTING_KEYS } from "@domain/setting";

import { push_toast, run_modal_progress_toast } from "@frontend/app/feedback/desktop-toast";
import { format_project_settings_aligned_toast } from "@frontend/app/feedback/project-settings-alignment-feedback";
import { useI18n } from "@frontend/app/locale/locale-context";
import { useDesktopState, useRuntimeSnapshot } from "@frontend/app/state/use-desktop-state";
import { is_runtime_busy } from "@frontend/app/state/runtime-activity-store";
import { useSettingsEditor } from "@frontend/features/settings-editor/use-settings-editor";
import type { SettingsSnapshot } from "@frontend/app/state/desktop-state-context";

const LABORATORY_PENDING_FIELDS = [
  "prompt_enhancement_enable",
  "agent_batch_translation_thinking_adaptive_enable",
  "mtool_optimizer_enable",
  "skip_duplicate_source_text_enable",
] as const;

export type LaboratoryField = (typeof LABORATORY_PENDING_FIELDS)[number];
type LaboratorySnapshot = Pick<SettingsSnapshot, LaboratoryField>;

type UseLaboratoryPageStateResult = {
  snapshot: LaboratorySnapshot;
  pending_state: Record<LaboratoryField, boolean>;
  runtime_locked: boolean;
  update_setting: (field: LaboratoryField, next_checked: boolean) => Promise<void>;
};

/** 页面只持有实验字段的乐观快照，保存与回滚交由通用设置编辑器。 */
function build_laboratory_snapshot(settings: SettingsSnapshot): LaboratorySnapshot {
  return {
    prompt_enhancement_enable: settings.prompt_enhancement_enable,
    agent_batch_translation_thinking_adaptive_enable:
      settings.agent_batch_translation_thinking_adaptive_enable,
    mtool_optimizer_enable: settings.mtool_optimizer_enable,
    skip_duplicate_source_text_enable: settings.skip_duplicate_source_text_enable,
  };
}

/** 组合设置编辑器与工程预过滤的运行锁和完成反馈。 */
export function useLaboratoryPageState(): UseLaboratoryPageStateResult {
  const { project_snapshot } = useDesktopState();
  const runtime_snapshot = useRuntimeSnapshot();

  const { t } = useI18n();
  const { snapshot, pending_state, commit_update } = useSettingsEditor({
    select_snapshot: build_laboratory_snapshot,
    pending_fields: LABORATORY_PENDING_FIELDS,
    refresh_error_key: "laboratory_page.feedback.refresh_failed",
    update_error_key: "app.feedback.settings_save_failed",
  });
  const runtime_locked = project_snapshot.loaded && is_runtime_busy(runtime_snapshot);

  // 工程字段受运行锁约束，应用偏好可供后续调用立即读取。
  const update_setting = useCallback(
    async (field: LaboratoryField, next_checked: boolean): Promise<void> => {
      const affects_project = PROJECT_SETTING_KEYS.some((key) => key === field);
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
            ? "app.feedback.project_cache_loading"
            : "app.feedback.project_cache_loading";
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
    update_setting,
  };
}
