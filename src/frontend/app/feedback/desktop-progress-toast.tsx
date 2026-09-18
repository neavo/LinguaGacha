import { useLayoutEffect, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { ProgressToastRing } from "@frontend/widgets/progress-toast-ring/progress-toast-ring";
import {
  PROGRESS_TOAST_SONNER_ID,
  read_progress_toast,
  subscribe_progress_toast,
} from "./desktop-toast";

/** 通知和输入遮罩投影同一任务快照，订阅与展示随窗口挂载。 */
export function DesktopProgressToast(): JSX.Element | null {
  const progress = useSyncExternalStore(subscribe_progress_toast, read_progress_toast);
  useLayoutEffect(() => {
    if (progress === null) {
      toast.dismiss(PROGRESS_TOAST_SONNER_ID);
      return;
    }
    toast(progress.message, {
      id: PROGRESS_TOAST_SONNER_ID,
      icon: <ProgressToastRing progress_percent={progress.progress_percent} />,
      position: "bottom-center",
      duration: Number.POSITIVE_INFINITY,
      dismissible: false,
      closeButton: false,
      classNames: {
        toast: `cn-toast cn-toast--progress${progress.presentation === "modal" ? " cn-toast--progress-modal" : ""}`,
      },
    });
  }, [progress]);
  useLayoutEffect(
    () => () => {
      toast.dismiss(PROGRESS_TOAST_SONNER_ID);
    },
    [],
  );
  return progress?.presentation === "modal" ? (
    <div className="cn-progress-toast-modal-layer" aria-hidden="true" />
  ) : null;
}
