import { useCallback, useEffect, useRef } from "react";

/** 所有跟随路径共用同一个归底写入口。 */
function write_scroll_end(target: HTMLElement): void {
  target.scrollTop = target.scrollHeight;
}

/** 页面会话与活动思考视口共用的最小自动归底工具。 */
type AgentAutoScroll = {
  follow_content: (target: HTMLElement) => void;
  scroll_to_end: (target: HTMLElement) => void;
};

/** 页面级跟随状态由 AgentPage 拥有；此 Hook 只处理内容变化后的合帧归底。 */
export function useAgentAutoScroll(enabled: boolean): AgentAutoScroll {
  const enabled_ref = useRef(enabled); // 在合帧回调执行前读取最新的页面跟随状态
  const pending_follow_frame_ref = useRef<number | null>(null); // 同一布局帧最多保留一个跟随写入
  enabled_ref.current = enabled;

  /** 取消尚未提交的合帧位置写入。 */
  const clear_pending_follow = useCallback((): void => {
    if (pending_follow_frame_ref.current === null) return;
    cancelAnimationFrame(pending_follow_frame_ref.current);
    pending_follow_frame_ref.current = null;
  }, []);

  /** 合并同一布局帧的尺寸变化；滚动事件不参与跟随状态判断。 */
  const follow_content = useCallback((target: HTMLElement): void => {
    if (!enabled_ref.current) return;
    if (pending_follow_frame_ref.current !== null) return;
    pending_follow_frame_ref.current = requestAnimationFrame(() => {
      pending_follow_frame_ref.current = null;
      if (!enabled_ref.current) return;
      write_scroll_end(target);
    });
  }, []);

  /** 立即归底并清除尚未提交的合帧写入。 */
  const scroll_to_end = useCallback(
    (target: HTMLElement): void => {
      clear_pending_follow();
      write_scroll_end(target);
    },
    [clear_pending_follow],
  );

  useEffect(
    () => () => {
      clear_pending_follow();
    },
    [clear_pending_follow],
  );

  return {
    follow_content,
    scroll_to_end,
  };
}
