import { useRef, useState } from "react";
import { api_fetch } from "@frontend/app/desktop/desktop-api";
import { useI18n } from "@frontend/app/locale/locale-context";
import { push_error_toast } from "@frontend/app/feedback/desktop-toast";
import { useDesktopState, useRuntimeSnapshot } from "@frontend/app/state/use-desktop-state";
import { usePageLeave } from "@frontend/app/navigation/page-leave-context";

export function useProjectCloseFlow() {
  const { t } = useI18n();
  const { project_snapshot, refresh_projects } = useDesktopState();
  const runtime = useRuntimeSnapshot();
  const { prepare_page_leave } = usePageLeave();
  const [target, set_target] = useState<string | null>(null);
  const [closing, set_closing] = useState(false);
  const submitting = useRef(false);
  const can_close = (id: string): boolean => {
    const state = runtime.projects?.[id];
    return !closing && !state?.projectWrite && !state?.batchTranslation && !state?.activeChatCount;
  };
  async function confirm(): Promise<void> {
    if (target === null || !can_close(target) || submitting.current) return;
    submitting.current = true;
    set_closing(true);
    try {
      if (!(await prepare_page_leave({ kind: "project", projectId: target }))) return;
      await api_fetch("/api/session/project/close", { projectId: target });
      set_target(null);
      await refresh_projects();
    } catch (error) {
      push_error_toast(t("project.close.failed"), error);
    } finally {
      submitting.current = false;
      set_closing(false);
    }
  }
  return {
    closing,
    can_close: project_snapshot.projectId !== undefined && can_close(project_snapshot.projectId),
    request_close: (id = project_snapshot.projectId) => {
      if (id && can_close(id)) set_target(id);
    },
    dialog_props: {
      open: target !== null,
      description: t("project.close.confirm"),
      submitting: closing,
      confirmDisabled: target === null || !can_close(target),
      onConfirm: confirm,
      onClose: () => set_target(null),
    },
  };
}
