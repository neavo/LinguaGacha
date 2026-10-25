import { useCallback, useEffect, useRef, useState } from "react";
import { api_fetch, DesktopApiError } from "@frontend/app/desktop/desktop-api";
import { useDesktopState } from "@frontend/app/state/use-desktop-state";
import { useI18n } from "@frontend/app/locale/locale-context";
import { push_error_toast, push_toast } from "@frontend/app/feedback/desktop-toast";
import {
  format_project_settings_aligned_toast,
  type ProjectSettingsAlignmentSettings,
  type ProjectSettingsAlignmentChangedFields,
} from "@frontend/app/feedback/project-settings-alignment-feedback";
import type { ProjectPreview, ProjectPreviewResponse } from "@shared/project-preview";
import { read_project_version_confirmation, type ProjectOpenRequest } from "@shared/project-open";

type SelectedProject = { path: string; from_recent: boolean }; // 最近记录缺失时提供移除入口。
type PreviewState =
  | { status: "idle" | "loading" | "failed" }
  | { status: "ready"; preview: ProjectPreview };
type PendingConfirmation = SelectedProject & { target_app_version: string };
type ProjectOpenPayload = {
  settings_alignment?: {
    settings?: ProjectSettingsAlignmentSettings;
    changed?: ProjectSettingsAlignmentChangedFields;
  };
};
type LoadingModal = (args: { initial_message: string; task: () => Promise<void> }) => Promise<void>;

/** 页面本地拥有打开意图。预览结果不决定是否允许打开，确认绑定本次路径与版本。 */
export function useProjectOpen(run_loading_modal: LoadingModal) {
  const { t } = useI18n();
  const {
    set_project_session_status,
    refresh_project_snapshot,
    refresh_settings,
    refresh_batch_translation,
  } = useDesktopState();
  const [selected_project, set_selected_project] = useState<SelectedProject | null>(null);
  const [preview_state, set_preview_state] = useState<PreviewState>({ status: "idle" });
  const [is_opening_project, set_is_opening_project] = useState(false);
  const [pending_confirmation, set_pending_confirmation] = useState<PendingConfirmation | null>(
    null,
  );
  const [missing_recent_project, set_missing_recent_project] = useState<SelectedProject | null>(
    null,
  );
  const preview_request = useRef<AbortController | null>(null); // 对象身份同时隔离迟到的结果和收尾。
  const opening = useRef(false); // 同一帧的重复操作也必须互斥。
  const mounted = useRef(true); // 离页后结束本地确认意图，已受理的后端打开继续收尾。

  /** 中止传输并撤销请求身份，使迟到的结果失效。 */
  const cancel_preview = useCallback(() => {
    preview_request.current?.abort();
    preview_request.current = null;
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancel_preview();
    };
  }, [cancel_preview]);

  /** 清空选择同时结束绑定到该路径的预览和确认。 */
  function clear_selected_project(): void {
    cancel_preview();
    set_selected_project(null);
    set_preview_state({ status: "idle" });
    set_pending_confirmation(null);
  }

  /** 先保存路径，允许用户在预览完成前发起打开。 */
  async function select_project_path(path: string, from_recent = false): Promise<void> {
    if (opening.current) return;
    cancel_preview();
    const request = new AbortController();
    preview_request.current = request;
    set_selected_project({ path, from_recent });
    set_pending_confirmation(null);
    set_preview_state({ status: "loading" });
    try {
      const { preview } = await api_fetch<ProjectPreviewResponse>(
        "/api/session/project/preview",
        { path },
        request.signal,
      );
      if (preview_request.current === request) set_preview_state({ status: "ready", preview });
    } catch (error) {
      if (preview_request.current !== request) return;
      set_preview_state({ status: "failed" });
      push_error_toast(t("project_page.open.preview_unavailable"), error);
    } finally {
      if (preview_request.current === request) preview_request.current = null;
    }
  }

  /** 确认重试仍经过正式打开入口，由后端重新核对版本。 */
  async function open_project(
    target: SelectedProject,
    confirmed_target_app_version?: string,
  ): Promise<void> {
    if (opening.current || !mounted.current) return;
    opening.current = true;
    cancel_preview();
    set_preview_state((previous) =>
      previous.status === "loading" ? { status: "idle" } : previous,
    );
    set_pending_confirmation(null);
    set_is_opening_project(true);
    try {
      let alignment: ProjectOpenPayload["settings_alignment"];
      await run_loading_modal({
        initial_message: t("project_page.open.loading_toast"),
        task: async () => {
          const request: ProjectOpenRequest = {
            path: target.path,
            ...(confirmed_target_app_version === undefined ? {} : { confirmed_target_app_version }),
          };
          const response = await api_fetch<ProjectOpenPayload>(
            "/api/session/project/open",
            request,
          );
          alignment = response.settings_alignment;
          set_project_session_status("warming");
          await refresh_project_snapshot();
          const file_name = target.path.split(/[\\/]/u).pop() ?? target.path;
          await api_fetch("/api/settings/recent-projects/add", {
            path: target.path,
            name: file_name.replace(/\.[^.]+$/u, ""),
          });
          await Promise.all([refresh_settings(), refresh_batch_translation()]);
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
      if (!mounted.current) return;
      if (error instanceof DesktopApiError) {
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
      if (mounted.current) set_is_opening_project(false);
    }
  }

  /** 移除成功后刷新共享记录，失败时保留当前恢复入口。 */
  async function handle_recent_project_remove(path: string): Promise<void> {
    try {
      await api_fetch("/api/settings/recent-projects/remove", { path });
      await refresh_settings();
      set_missing_recent_project(null);
    } catch (error) {
      push_error_toast(t("project_page.open.remove_unavailable"), error);
    }
  }

  return {
    selected_project,
    preview_state,
    is_opening_project,
    pending_confirmation,
    missing_recent_project,
    clear_selected_project,
    select_project_path,
    handle_recent_project_remove,
    handle_open_project: () => selected_project && open_project(selected_project),
    confirm_open: () =>
      pending_confirmation &&
      open_project(pending_confirmation, pending_confirmation.target_app_version),
    cancel_confirmation: () => set_pending_confirmation(null),
    close_missing_recent: () => set_missing_recent_project(null),
  };
}
