import { useCallback, useEffect, useRef, useState } from "react";

/** 吸收触控板微小位移与布局误差的底部容差。 */
export const AGENT_SCROLL_BOTTOM_TOLERANCE_PX = 16;

function is_near_scroll_end(target: HTMLElement): boolean {
  return (
    target.scrollHeight - target.scrollTop - target.clientHeight <= AGENT_SCROLL_BOTTOM_TOLERANCE_PX
  );
}

type AgentFollowLatest = {
  following: boolean;
  follow_content: (target: HTMLElement) => void;
  scroll_to_end: (target: HTMLElement) => void;
  activate: (target: HTMLElement | null) => void;
  deactivate: () => void;
  handle_scroll: (target: HTMLElement) => void;
};

/**
 * 管理一个滚动容器的跟随状态与合帧归底。
 * 用户向上滚离底部时自动退出跟随，重新跟随只能由显式 activate 触发。
 */
export function useAgentFollowLatest(initial_following: boolean): AgentFollowLatest {
  const [following, set_following] = useState(initial_following);
  const following_ref = useRef(initial_following);
  const last_scroll_top_ref = useRef<number | null>(null);
  const pending_follow_frame_ref = useRef<number | null>(null);
  following_ref.current = following;

  /** 归底后记录浏览器实际接受的位置，供滚动方向判断使用。 */
  const write_scroll_end = useCallback((target: HTMLElement): void => {
    target.scrollTop = target.scrollHeight;
    last_scroll_top_ref.current = target.scrollTop;
  }, []);

  /** 取消尚未提交的合帧位置写入。 */
  const clear_pending_follow = useCallback((): void => {
    if (pending_follow_frame_ref.current === null) return;
    cancelAnimationFrame(pending_follow_frame_ref.current);
    pending_follow_frame_ref.current = null;
  }, []);

  /** 合并同一布局帧的尺寸变化；跟随关闭后不再写入滚动位置。 */
  const follow_content = useCallback(
    (target: HTMLElement): void => {
      if (!following_ref.current || pending_follow_frame_ref.current !== null) return;
      pending_follow_frame_ref.current = requestAnimationFrame(() => {
        pending_follow_frame_ref.current = null;
        if (following_ref.current) write_scroll_end(target);
      });
    },
    [write_scroll_end],
  );

  /** 立即归底但不改变当前跟随状态。 */
  const scroll_to_end = useCallback(
    (target: HTMLElement): void => {
      clear_pending_follow();
      write_scroll_end(target);
    },
    [clear_pending_follow, write_scroll_end],
  );

  /** 显式激活跟随并立即归底；空目标允许按钮在 DOM 更新前触发。 */
  const activate = useCallback(
    (target: HTMLElement | null): void => {
      clear_pending_follow();
      following_ref.current = true;
      set_following(true);
      if (target !== null) write_scroll_end(target);
    },
    [clear_pending_follow, write_scroll_end],
  );

  /** 显式退出跟随并取消已经排队的归底帧。 */
  const deactivate = useCallback((): void => {
    clear_pending_follow();
    following_ref.current = false;
    set_following(false);
  }, [clear_pending_follow]);

  /** 只有用户实际向上滚离底部时才退出跟随；内容增长与程序归底不改变状态。 */
  const handle_scroll = useCallback(
    (target: HTMLElement): void => {
      const previous_scroll_top = last_scroll_top_ref.current;
      const current_scroll_top = target.scrollTop;
      last_scroll_top_ref.current = current_scroll_top;
      if (
        previous_scroll_top !== null &&
        current_scroll_top < previous_scroll_top &&
        !is_near_scroll_end(target)
      ) {
        deactivate();
      }
    },
    [deactivate],
  );

  useEffect(
    () => () => {
      clear_pending_follow();
    },
    [clear_pending_follow],
  );

  return {
    following,
    follow_content,
    scroll_to_end,
    activate,
    deactivate,
    handle_scroll,
  };
}
