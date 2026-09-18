import { useEffect, useRef } from "react";
import {
  useAgentControls,
  useAgentTimeline,
} from "@frontend/app/session/agent/agent-session-context";

/**
 * 跨路由观察 Agent 终态；宿主只收到无参数的注意力请求，不承载 Agent 业务字段。
 */
export function AgentCompletionAttention(): null {
  const { state } = useAgentControls();
  const { entries } = useAgentTimeline();
  const was_running_ref = useRef(false); // 只记住已观察到的运行，避免恢复历史终态时补发提醒

  useEffect(() => {
    if (state === "running") {
      was_running_ref.current = true;
      return;
    }
    if (!was_running_ref.current) return;
    was_running_ref.current = false;
    // 时间线按发生顺序追加，普通用户轮次的终态决定是否提醒。
    const round = entries.findLast(
      (entry) => entry.kind === "user_message" && entry.delivery === "round",
    );
    if (round?.status === "success" || round?.status === "error") {
      window.desktopApp.requestUserAttention();
    }
  }, [entries, state]);

  return null;
}
