import { useRef, useState } from "react";
import { api_fetch } from "@frontend/app/desktop/desktop-api";
import { useI18n } from "@frontend/app/locale/locale-context";
import { push_error_toast } from "@frontend/app/feedback/desktop-toast";
import { useDesktopState, useRuntimeSnapshot } from "@frontend/app/state/use-desktop-state";
import { is_runtime_busy } from "@frontend/app/state/runtime-activity-store";

/** 所有页面共用关闭确认，路由由工程快照驱动。 */
export function useProjectCloseFlow() {
  const { t } = useI18n();
  const { project_snapshot, refresh_project_snapshot, refresh_batch_translation } =
    useDesktopState();
  const runtime_snapshot = useRuntimeSnapshot();
  const [open, set_open] = useState(false);
  const [closing, set_closing] = useState(false);
  const submitting = useRef(false); // 同一帧的重复确认不能发出两次关闭请求。
  const can_close = project_snapshot.loaded && !is_runtime_busy(runtime_snapshot) && !closing;
  /** 提交前重查运行占用，失败保留确认以便重试。 */
  async function confirm(): Promise<void> {
    if (!can_close || submitting.current) return;
    submitting.current = true;
    set_closing(true);
    try {
      await api_fetch("/api/session/project/close", {});
      await refresh_project_snapshot();
      await refresh_batch_translation();
      set_open(false);
    } catch (error) {
      push_error_toast(t("project.close.failed"), error);
    } finally {
      submitting.current = false;
      set_closing(false);
    }
  }
  return {
    closing,
    can_close,
    request_close: () => {
      if (can_close) set_open(true);
    },
    dialog_props: {
      open,
      description: t("project.close.confirm"),
      submitting: closing,
      confirmDisabled: !can_close,
      onConfirm: confirm,
      onClose: () => set_open(false),
    },
  };
}
