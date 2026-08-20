import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

const AGENT_SCROLL_END_TOLERANCE_PX = 2;
const AGENT_SCROLL_KEYS = new Set([
  "ArrowDown",
  "ArrowUp",
  "End",
  "Home",
  "PageDown",
  "PageUp",
  " ",
]);

/** 页面会话与思考详情共用的最小跟随控制面。 */
type AgentScrollFollow = {
  paused: boolean;
  paused_ref: RefObject<boolean>; // 给 ResizeObserver 等提交外回调读取同步所有权
  follow_user_scroll: (target: HTMLElement) => void;
  resume: () => void;
};

/** 小幅容忍浏览器的亚像素舍入；是否暂停由用户滚动意图另行决定。 */
export function is_at_scroll_end(target: HTMLElement): boolean {
  return (
    target.scrollHeight - target.scrollTop - target.clientHeight <= AGENT_SCROLL_END_TOLERANCE_PX
  );
}

/** 只把可能改变滚动位置的键盘操作视为用户接管。 */
export function is_agent_scroll_key(key: string): boolean {
  return AGENT_SCROLL_KEYS.has(key);
}

/** 统一拥有滚动容器的用户接管状态；脚本和布局滚动没有用户意图时不得改变它。 */
export function useAgentScrollFollow(): AgentScrollFollow {
  const paused_ref = useRef(false); // 布局回调在 React 提交前也必须读取最新所有权
  const pending_frame_ref = useRef<number | null>(null); // 同帧连续输入只需一次最终位置裁决
  const [paused, set_paused] = useState(false);

  /** 同步 ref 与可见状态，避免各消费方复制双写顺序。 */
  const set_follow_paused = useCallback((next: boolean): void => {
    if (paused_ref.current === next) return;
    paused_ref.current = next;
    set_paused(next);
  }, []);

  /** 用户输入后的下一帧读取最终位置；没有位移时保持跟随，程序滚动不会进入此入口。 */
  const follow_user_scroll = useCallback(
    (target: HTMLElement): void => {
      if (pending_frame_ref.current !== null) cancelAnimationFrame(pending_frame_ref.current);
      pending_frame_ref.current = requestAnimationFrame(() => {
        pending_frame_ref.current = null;
        set_follow_paused(!is_at_scroll_end(target));
      });
    },
    [set_follow_paused],
  );

  /** 显式回到最新同时清除暂停与尚未执行的用户位置裁决。 */
  const resume = useCallback((): void => {
    if (pending_frame_ref.current !== null) cancelAnimationFrame(pending_frame_ref.current);
    pending_frame_ref.current = null;
    set_follow_paused(false);
  }, [set_follow_paused]);

  // 组件卸载后取消尚未执行的帧回调，避免过期 DOM 参与裁决。
  useEffect(
    () => () => {
      if (pending_frame_ref.current !== null) cancelAnimationFrame(pending_frame_ref.current);
    },
    [],
  );

  return { paused, paused_ref, follow_user_scroll, resume };
}
