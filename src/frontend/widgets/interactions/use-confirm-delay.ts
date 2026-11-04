import { useLayoutEffect, useState } from "react";

// 延迟确认采用统一时长，业务层只判断动作是否需要保护。
const CONFIRM_DELAY_SECONDS = 3;

/** 弹窗打开时倒数主操作的剩余秒数，归零即可执行。各类弹窗共用，秒数与禁用不会漂移。 */
export function useConfirmDelay(open: boolean, delayed: boolean): number {
  const [remaining_seconds, set_remaining_seconds] = useState(0); // 当前弹窗的瞬时倒计时，不进入业务状态
  useLayoutEffect(() => {
    if (!open || !delayed) {
      set_remaining_seconds(0);
      return;
    }

    // 在弹窗绘制前锁定主操作，避免打开瞬间短暂暴露可提交状态。
    set_remaining_seconds(CONFIRM_DELAY_SECONDS);
    // 每秒递减，归零后立即停止，避免弹窗关闭后继续持有定时器。
    const timer_id = window.setInterval(() => {
      set_remaining_seconds((previous_seconds) => {
        if (previous_seconds <= 1) {
          window.clearInterval(timer_id);
          return 0;
        }

        return previous_seconds - 1;
      });
    }, 1_000);

    return () => window.clearInterval(timer_id);
  }, [delayed, open]);
  return open ? remaining_seconds : 0;
}
