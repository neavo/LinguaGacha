import { useEffect } from "react";
import type { BatchTaskRequestRecovery } from "@domain/batch-task";
import { useBatchTaskSnapshot } from "@frontend/app/state/use-desktop-state";
import { useI18n } from "@frontend/app/locale/locale-context";
import { dismiss_toast, push_toast } from "@frontend/app/feedback/desktop-toast";

const RECOVERY_TOAST_ID = "batch-task-recovery";
const COUNTDOWN_INTERVAL_MS = 1_000;

/** 会话拥有唯一恢复通知，页面切换不重建任务状态，显示时钟不参与请求调度。 */
export function BatchTaskRecoveryToast(): null {
  const snapshot = useBatchTaskSnapshot();
  let recovery: BatchTaskRequestRecovery | null = null;
  for (const task of snapshot.tasks) {
    if (task.status !== "running" || task.request_recovery === null) continue;
    const next = task.request_recovery;
    if (
      recovery === null ||
      next.phase === "retrying" ||
      (recovery.phase === "waiting" && next.retry_at < recovery.retry_at)
    )
      recovery = next;
    if (recovery.phase === "retrying") break;
  }
  const phase = recovery?.phase;
  const retry_at = recovery?.phase === "waiting" ? recovery.retry_at : 0;
  const retry_count = recovery?.phase === "waiting" ? recovery.retry_count : 0;
  const { t } = useI18n();
  useEffect(() => {
    if (phase === undefined) {
      dismiss_toast(RECOVERY_TOAST_ID);
      return;
    }
    // 每次显示都按截止时间重算，后台页面恢复后也能显示实际剩余秒数。
    const update = (): void => {
      const message =
        phase === "waiting"
          ? t("batch_translation.feedback.keys_retry_wait", {
              count: String(retry_count),
              seconds: String(
                Math.max(0, Math.ceil((retry_at - Date.now()) / COUNTDOWN_INTERVAL_MS)),
              ),
            })
          : t("batch_translation.feedback.keys_retry_running");
      push_toast("warning", message, {
        id: RECOVERY_TOAST_ID,
        dismissible: false,
      });
    };
    update();
    if (phase !== "waiting") return;
    const timer = window.setInterval(update, COUNTDOWN_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [phase, retry_at, retry_count, t]);
  useEffect(
    () => () => {
      dismiss_toast(RECOVERY_TOAST_ID);
    },
    [],
  );
  return null;
}
