import type { AgentEntryStatus } from "@shared/agent";

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
