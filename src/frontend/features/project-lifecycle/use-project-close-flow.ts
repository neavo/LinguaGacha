import { useState } from "react";
import { api_fetch } from "@frontend/app/desktop/desktop-api";
import { useI18n } from "@frontend/app/locale/locale-context";
import { push_error_toast } from "@frontend/app/feedback/desktop-toast";
import { useDesktopState, useRuntimeSnapshot } from "@frontend/app/state/use-desktop-state";
import { usePageLeave } from "@frontend/app/navigation/page-leave-context";
import { is_project_busy } from "@frontend/app/state/runtime-activity-store";

/** 已打开工程先完成离页保存与关闭，成功后才移除最近记录。 */
export function useProjectCloseFlow(remove_recent_project: (path: string) => Promise<void>) {
  const { t } = useI18n();
  const { refresh_projects } = useDesktopState();
  const runtime = useRuntimeSnapshot();
  const { prepare_page_leave } = usePageLeave();
  const [target, set_target] = useState<{
    projectId: string;
    remove_path: string | undefined;
  } | null>(null);
  const [closing, set_closing] = useState(false);
  const can_close = (id: string): boolean => !closing && !is_project_busy(runtime.projects?.[id]);

  /** 关闭失败保留原确认目标，用户可以在同一弹窗重试。 */
  async function confirm(): Promise<void> {
    if (target === null || !can_close(target.projectId)) return;
    set_closing(true);
    try {
      if (!(await prepare_page_leave({ kind: "project", projectId: target.projectId }))) return;
      await api_fetch("/api/session/project/close", { projectId: target.projectId });
      set_target(null);
      if (target.remove_path !== undefined) await remove_recent_project(target.remove_path);
      await refresh_projects();
    } catch (error) {
      push_error_toast(t("project.close.failed"), error);
    } finally {
      set_closing(false);
    }
  }
  return {
    closing,
    request_close: (id: string, remove_path?: string) => {
      if (can_close(id)) set_target({ projectId: id, remove_path });
    },
    dialog_props: {
      open: target !== null,
      description: t(
        target?.remove_path === undefined
          ? "project.close.confirm"
          : "app.workspace.remove_confirm",
      ),
      submitting: closing,
      confirmDisabled: target === null || !can_close(target.projectId),
      onConfirm: confirm,
      onClose: () => set_target(null),
    },
  };
}
