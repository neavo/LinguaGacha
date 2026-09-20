import { useEffect } from "react";
import { useBatchTranslationSnapshot } from "@frontend/app/state/use-desktop-state";
import { useI18n } from "@frontend/app/locale/locale-context";
import { dismiss_toast, push_toast } from "@frontend/app/feedback/desktop-toast";

const RECOVERY_TOAST_ID = "batch-translation-recovery";
const COUNTDOWN_INTERVAL_MS = 1_000;

/** 会话拥有唯一恢复通知，页面切换不重建任务状态，显示时钟不参与请求调度。 */
export function BatchTranslationRecoveryToast(): null {
  const { request_recovery: recovery } = useBatchTranslationSnapshot();
  const { t } = useI18n();
  useEffect(() => {
    if (recovery === null) {
      dismiss_toast(RECOVERY_TOAST_ID);
      return;
    }
    // 每次显示都按截止时间重算，后台页面恢复后也能显示实际剩余秒数。
    const update = (): void => {
      const count = String(recovery.retry_count);
      const seconds =
        recovery.retry_at !== null
          ? Math.max(0, Math.ceil((recovery.retry_at - Date.now()) / COUNTDOWN_INTERVAL_MS))
          : 0;
      const key =
        seconds > 0
          ? "batch_translation.feedback.keys_retry_wait"
          : "batch_translation.feedback.keys_retry_running";
      push_toast("warning", t(key, { count, seconds: String(seconds) }), {
        id: RECOVERY_TOAST_ID,
        dismissible: false,
      });
    };
    update();
    if (recovery.retry_at === null) return;
    const timer = window.setInterval(update, COUNTDOWN_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [recovery, t]);
  useEffect(
    () => () => {
      dismiss_toast(RECOVERY_TOAST_ID);
    },
    [],
  );
  return null;
}
