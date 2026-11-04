import { useRef, useState } from "react";
import { api_fetch, DesktopApiError } from "@frontend/app/desktop/desktop-api";
import { useDesktopState } from "@frontend/app/state/use-desktop-state";
import { useI18n } from "@frontend/app/locale/locale-context";
import { push_error_toast, push_toast } from "@frontend/app/feedback/desktop-toast";
import {
  format_project_settings_aligned_toast,
  type ProjectSettingsAlignmentSettings,
  type ProjectSettingsAlignmentChangedFields,
} from "@frontend/app/feedback/project-settings-alignment-feedback";
import type { RunProjectLoad } from "./use-project-load";
import { read_project_version_confirmation, type ProjectOpenRequest } from "@shared/project-open";

type SelectedProject = { path: string; from_recent: boolean }; // 最近记录缺失时提供移除入口。
type PendingConfirmation = SelectedProject & { target_app_version: string };
type ProjectOpenPayload = {
  settings_alignment?: {
    settings?: ProjectSettingsAlignmentSettings;
    changed?: ProjectSettingsAlignmentChangedFields;
  };
};

/** 工程打开随应用会话常驻，版本确认绑定本次路径。 */
export function useProjectOpenFlow(run_project_load: RunProjectLoad) {
  const { t } = useI18n();
  const { settings_snapshot, refresh_settings } = useDesktopState();
  const [is_opening_project, set_is_opening_project] = useState(false);
  const [pending_confirmation, set_pending_confirmation] = useState<PendingConfirmation | null>(
    null,
  );
  const [missing_recent_project, set_missing_recent_project] = useState<SelectedProject | null>(
    null,
  );
  const opening = useRef(false); // 文件选择与加载共用互斥，防止重复调起系统窗口。
  /** 未传路径时选择文件，选中后与最近工程、版本确认共用加载流程。 */
  async function open_project(
    path?: string,
    from_recent = false,
    confirmed_target_app_version?: string,
  ): Promise<void> {
    if (opening.current) return;
    let target: SelectedProject | null = path === undefined ? null : { path, from_recent };
    opening.current = true;
    set_pending_confirmation(null);
    set_is_opening_project(true);
    try {
      if (target === null) {
        const result = await window.desktopApp.pickProjectFilePath(
          settings_snapshot.project_save_mode === "FIXED"
            ? settings_snapshot.project_fixed_path
            : undefined,
        );
        const selected_path = result.paths[0];
        if (result.canceled || selected_path === undefined) return;
        target = { path: selected_path, from_recent: false };
      }
      const selected_project = target; // 加载闭包与失败确认使用同一次文件选择。
      let alignment: ProjectOpenPayload["settings_alignment"];
      await run_project_load({
        message: t("project.open.loading_toast"),
        request: async () => {
          const request: ProjectOpenRequest = {
            path: selected_project.path,
            ...(confirmed_target_app_version === undefined ? {} : { confirmed_target_app_version }),
          };
          const response = await api_fetch<ProjectOpenPayload>(
            "/api/session/project/open",
            request,
          );
          alignment = response.settings_alignment;
          return selected_project.path;
        },
      });
      if (alignment)
        push_toast(
          "info",
          format_project_settings_aligned_toast({
            settings: alignment.settings ?? {},
            changed_fields: alignment.changed ?? {},
            t,
          }),
        );
    } catch (error) {
      if (target !== null && error instanceof DesktopApiError) {
        if (error.code === "project.newer_app_version") {
          const details = read_project_version_confirmation(error.details);
          if (details) {
            set_pending_confirmation({ ...target, target_app_version: details.target_app_version });
            return;
          }
        }
        if (target.from_recent && error.code === "project.not_found") {
          set_missing_recent_project(target);
          return;
        }
      }
      push_error_toast(t("app.feedback.load_failed"), error);
    } finally {
      opening.current = false;
      set_is_opening_project(false);
    }
  }

  /** 移除成功后刷新共享记录，失败时保留当前恢复入口。 */
  async function handle_recent_project_remove(path: string): Promise<void> {
    try {
      await api_fetch("/api/settings/recent-projects/remove", { path });
      await refresh_settings();
      set_missing_recent_project(null);
    } catch (error) {
      push_error_toast(t("project.open.remove_unavailable"), error);
    }
  }

  return {
    is_opening_project,
    pending_confirmation,
    missing_recent_project,
    handle_recent_project_remove,
    open_project,
    confirm_open: () =>
      pending_confirmation === null
        ? Promise.resolve()
        : open_project(
            pending_confirmation.path,
            pending_confirmation.from_recent,
            pending_confirmation.target_app_version,
          ),
    cancel_confirmation: () => set_pending_confirmation(null),
    close_missing_recent: () => set_missing_recent_project(null),
  };
}
