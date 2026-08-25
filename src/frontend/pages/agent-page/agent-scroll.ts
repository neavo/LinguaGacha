import { useCallback, useEffect, useRef, useState } from "react";

/** 容差吸收亚像素舍入。 */
const AGENT_SCROLL_END_TOLERANCE_PX = 2;

/** 所有跟随路径共用同一个归底写入口。 */
function scroll_to_end(target: HTMLElement): void {
  target.scrollTop = target.scrollHeight;
}

/** 页面会话与思考视口共用的最小滚动所有权控制面。 */
type AgentScrollFollow = {
  paused: boolean;
  follow_content: (target: HTMLElement) => void;
  reconcile_scroll: (target: HTMLElement) => void;
  settle_scroll: (target: HTMLElement) => void;
  resume: (target: HTMLElement) => void;
};

/** 小幅容忍浏览器的亚像素舍入。 */
export function is_at_scroll_end(target: HTMLElement): boolean {
  return (
    target.scrollHeight - target.scrollTop - target.clientHeight <= AGENT_SCROLL_END_TOLERANCE_PX
  );
}

/** 每个滚动容器独立拥有一个显式跟随状态和唯一归底写入口。 */
export function useAgentScrollFollow(initial_paused = false): AgentScrollFollow {
  const following_ref = useRef(!initial_paused); // 同步保留当前滚动所有权，避免等待 React 提交
  const pending_follow_frame_ref = useRef<number | null>(null); // 同一布局帧最多保留一个跟随写入
  const reset_epoch_ref = useRef(0); // 让 resume 前已排队的布局回调失效
  const reset_pending_ref = useRef(false); // scrollend 前屏蔽迟到的旧几何事件
  const [paused, set_paused] = useState(initial_paused);

  /** 同步更新 Hook 内部所有权和按钮可见状态。 */
  const set_following = useCallback((following: boolean): void => {
    following_ref.current = following;
    set_paused(!following);
  }, []);

  /** 取消尚未提交的合帧位置写入。 */
  const clear_pending_follow = useCallback((): void => {
    if (pending_follow_frame_ref.current === null) return;
    cancelAnimationFrame(pending_follow_frame_ref.current);
    pending_follow_frame_ref.current = null;
  }, []);

  /** 合并同一布局帧的尺寸变化；不以迟到事件恢复旧所有权。 */
  const follow_content = useCallback((target: HTMLElement): void => {
    if (reset_pending_ref.current || !following_ref.current) return;
    if (pending_follow_frame_ref.current !== null) return;
    const epoch = reset_epoch_ref.current;
    pending_follow_frame_ref.current = requestAnimationFrame(() => {
      pending_follow_frame_ref.current = null;
      if (
        epoch !== reset_epoch_ref.current ||
        reset_pending_ref.current ||
        !following_ref.current
      ) {
        return;
      }
      scroll_to_end(target);
    });
  }, []);

  /** 最终几何位置决定当前滚动所有权。 */
  const reconcile_scroll = useCallback(
    (target: HTMLElement): void => {
      if (reset_pending_ref.current) return;
      const at_end = is_at_scroll_end(target);
      if (!at_end) clear_pending_follow();
      set_following(at_end);
    },
    [clear_pending_follow, set_following],
  );

  /** reset 窗口结束后重新读取最终几何，并补齐期间发生的布局变化。 */
  const settle_scroll = useCallback(
    (target: HTMLElement): void => {
      reset_pending_ref.current = false;
      reconcile_scroll(target);
      if (following_ref.current) follow_content(target);
    },
    [follow_content, reconcile_scroll],
  );

  /** 可靠归底：使旧布局回调失效，迟到 scroll 在 scrollend 前不夺回所有权。 */
  const resume = useCallback(
    (target: HTMLElement): void => {
      clear_pending_follow();
      reset_epoch_ref.current += 1;
      reset_pending_ref.current = true;
      set_following(true);
      scroll_to_end(target);
    },
    [clear_pending_follow, set_following],
  );

  useEffect(
    () => () => {
      clear_pending_follow();
      reset_epoch_ref.current += 1;
    },
    [clear_pending_follow],
  );

  return {
    paused,
    follow_content,
    reconcile_scroll,
    settle_scroll,
    resume,
  };
}
