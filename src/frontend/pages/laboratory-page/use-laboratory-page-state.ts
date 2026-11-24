import { useCallback } from "react";
import {
  APP_PREFILTER_SETTING_KEYS,
  type AppPrefilterSettingKey,
  type AppPrefilterSettings,
} from "@domain/project-settings";

import { push_toast, run_modal_progress_toast } from "@frontend/app/feedback/desktop-toast";
import { format_project_settings_aligned_toast } from "@frontend/app/feedback/project-settings-alignment-feedback";
import { useI18n } from "@frontend/app/locale/locale-context";
import { useDesktopState, useRuntimeSnapshot } from "@frontend/app/state/use-desktop-state";
import { is_project_busy } from "@frontend/app/state/runtime-activity-store";
import { useSettingsEditor } from "@frontend/features/settings-editor/use-settings-editor";
import type { SettingsSnapshot } from "@frontend/app/state/desktop-state-context";

type UseLaboratoryPageStateResult = {
  snapshot: AppPrefilterSettings;
  pending_state: Record<AppPrefilterSettingKey, boolean>;
  runtime_locked: boolean;
  update_setting: (field: AppPrefilterSettingKey, next_checked: boolean) => Promise<void>;
};

/** 页面只持有实验字段的乐观快照，保存与回滚交由通用设置编辑器。 */
function build_laboratory_snapshot(settings: SettingsSnapshot): AppPrefilterSettings {
  return {
    mtool_optimizer_enable: settings.mtool_optimizer_enable,
    skip_duplicate_source_text_enable: settings.skip_duplicate_source_text_enable,
  };
}

/** 组合设置编辑器与工程预过滤的运行锁和完成反馈。 */
export function useLaboratoryPageState(): UseLaboratoryPageStateResult {
  const { open_projects } = useDesktopState();
  const has_open_projects = open_projects.length > 0;
  const runtime_snapshot = useRuntimeSnapshot();

  const { t } = useI18n();
  const { snapshot, pending_state, commit_update } = useSettingsEditor({
    select_snapshot: build_laboratory_snapshot,
    pending_fields: APP_PREFILTER_SETTING_KEYS,
  });
  const runtime_locked = Object.values(runtime_snapshot.projects ?? {}).some(is_project_busy);

  const update_setting = useCallback(
    async (field: AppPrefilterSettingKey, next_checked: boolean): Promise<void> => {
      if (runtime_locked || snapshot[field] === next_checked) return;
      const save = async (): Promise<void> => {
        const settings = await commit_update(field, { [field]: next_checked });
        if (settings !== null && has_open_projects) {
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
      if (has_open_projects) {
        await run_modal_progress_toast({
          message: t("app.feedback.operation_running"),
          task: save,
        });
      } else {
        await save();
      }
    },
    [commit_update, has_open_projects, runtime_locked, snapshot, t],
  );

  return {
    snapshot,
    pending_state,
    runtime_locked,
    update_setting,
  };
}
