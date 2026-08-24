import { useCallback, useEffect, useRef, useState } from "react";

/** 容差吸收亚像素舍入；键集合限定会改变滚动位置的键盘输入。 */
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

/** 所有跟随路径共用同一个归底写入口。 */
function scroll_to_end(target: HTMLElement): void {
  target.scrollTop = target.scrollHeight;
}

/** 页面会话与思考视口共用的最小滚动所有权控制面。 */
type AgentScrollFollow = {
  paused: boolean;
  follow_content: (target: HTMLElement) => void;
  begin_user_scroll: (target: HTMLElement) => void;
  reconcile_scroll: (target: HTMLElement) => void;
  resume: (target: HTMLElement) => void;
};

/** 小幅容忍浏览器的亚像素舍入。 */
export function is_at_scroll_end(target: HTMLElement): boolean {
  return (
    target.scrollHeight - target.scrollTop - target.clientHeight <= AGENT_SCROLL_END_TOLERANCE_PX
  );
}

/** 只把可能改变滚动位置的键盘操作视为用户接管。 */
export function is_agent_scroll_key(key: string): boolean {
  return AGENT_SCROLL_KEYS.has(key);
}

/** 每个滚动容器独立拥有一个显式跟随状态和唯一归底写入口。 */
export function useAgentScrollFollow(initial_paused = false): AgentScrollFollow {
  const paused_ref = useRef(initial_paused); // 尺寸回调必须在 React 提交前看到用户接管
  const pending_frame_ref = useRef<number | null>(null); // 同帧连续输入只保留一次最终裁决
  const pending_previous_paused_ref = useRef(initial_paused); // 无位移时恢复输入前所有权
  const [paused, set_paused] = useState(initial_paused);

  /** 同步提交可见状态与尺寸回调读取的所有权。 */
  const set_follow_paused = useCallback((next: boolean): void => {
    paused_ref.current = next;
    set_paused(next);
  }, []);

  /** 取消尚未完成的位置裁决。 */
  const clear_pending_frame = useCallback((): void => {
    if (pending_frame_ref.current === null) return;
    cancelAnimationFrame(pending_frame_ref.current);
    pending_frame_ref.current = null;
  }, []);

  /** 内容增长只在容器仍归页面所有时写入底端。 */
  const follow_content = useCallback((target: HTMLElement): void => {
    if (!paused_ref.current) scroll_to_end(target);
  }, []);

  /** 用户输入先同步阻断尺寸回调；若没有产生滚动，下一帧恢复输入前状态。 */
  const begin_user_scroll = useCallback(
    (target: HTMLElement): void => {
      if (pending_frame_ref.current === null) {
        pending_previous_paused_ref.current = paused_ref.current;
      } else {
        cancelAnimationFrame(pending_frame_ref.current);
      }
      paused_ref.current = true;
      pending_frame_ref.current = requestAnimationFrame(() => {
        pending_frame_ref.current = null;
        const previous_paused = pending_previous_paused_ref.current;
        set_follow_paused(previous_paused);
        if (!previous_paused) scroll_to_end(target);
      });
    },
    [set_follow_paused],
  );

  /** scroll 事件的最终几何位置决定用户是否仍在阅读历史。 */
  const reconcile_scroll = useCallback(
    (target: HTMLElement): void => {
      clear_pending_frame();
      set_follow_paused(!is_at_scroll_end(target));
    },
    [clear_pending_frame, set_follow_paused],
  );

  /** 显式回到最新同时恢复跟随并由同一入口归底。 */
  const resume = useCallback(
    (target: HTMLElement): void => {
      clear_pending_frame();
      set_follow_paused(false);
      scroll_to_end(target);
    },
    [clear_pending_frame, set_follow_paused],
  );

  // 组件卸载后不得让过期 DOM 参与位置裁决。
  useEffect(() => () => clear_pending_frame(), [clear_pending_frame]);

  return { paused, follow_content, begin_user_scroll, reconcile_scroll, resume };
}
