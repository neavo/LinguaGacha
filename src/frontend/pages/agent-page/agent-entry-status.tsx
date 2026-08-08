import { useEffect, useState } from "react";

import type { AgentEntryStatus } from "@shared/agent";
import type { LocaleKey } from "@frontend/app/locale/locale-provider";

/** 共享状态值只在此处映射为页面本地化键，避免各条目形成平行词表。 */
export const AGENT_STATUS_LABEL_KEYS: Readonly<Record<AgentEntryStatus, LocaleKey>> = Object.freeze(
  {
    running: "agent_page.status.running",
    success: "agent_page.status.success",
    error: "agent_page.status.error",
    stopped: "agent_page.status.stopped",
  },
);

/** 状态灯以颜色和可访问名称共同表达结果。 */
export function AgentStatusMark(props: { status: AgentEntryStatus; label: string }): JSX.Element {
  return (
    <span
      className={`agent-status-mark agent-status-mark--${props.status}`}
      role="img"
      aria-label={props.label}
    />
  );
}

/** 运行条目持有单个本地时钟；已结束轮次按后端时间冻结。 */
export function useAgentElapsed(started_at: number, running: boolean, ended_at?: number): string {
  const [now, set_now] = useState(Date.now);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => set_now(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [running]);

  return format_elapsed((running ? now : (ended_at ?? started_at)) - started_at);
}

/** 持续时间统一为紧凑、与语言无关的时分秒片段。 */
function format_elapsed(milliseconds: number): string {
  const total_seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(total_seconds / 3_600);
  const minutes = Math.floor((total_seconds % 3_600) / 60);
  const seconds = total_seconds % 60;
  if (hours > 0) {
    return `${hours.toString()}h ${minutes.toString().padStart(2, "0")}m ${seconds.toString().padStart(2, "0")}s`;
  }
  return minutes > 0
    ? `${minutes.toString()}m ${seconds.toString().padStart(2, "0")}s`
    : `${seconds.toString()}s`;
}
