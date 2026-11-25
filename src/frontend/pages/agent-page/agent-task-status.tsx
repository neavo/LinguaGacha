import "@frontend/widgets/status-mark.css";
import type { JSX } from "react";
import { useI18n } from "@frontend/app/locale/locale-context";
import { useBatchTaskSession } from "@frontend/app/session/batch-task/batch-task-session-context";
import { BatchTaskSummary } from "@frontend/features/batch-task/batch-task-summary";
import "./agent-task-status.css";

/**
 * 批量任务活跃时占用「正在处理」状态位。
 * 任务结束后恢复会话保留的 `doing`。
 */
export function AgentTaskStatus(props: {
  doing: string | null;
  running: boolean;
}): JSX.Element | null {
  const { t } = useI18n();
  const task = useBatchTaskSession();
  const { summary, metrics } = task;
  if (metrics.kind === null) {
    if (props.doing === null) return null;
    return (
      <div className="agent-doing" role="status">
        <span className="agent-doing__lead">
          <span
            className={`status-mark agent-status-mark${props.running ? " agent-status-mark--pending agent-status-mark--running status-mark--pulse" : ""}`}
            aria-hidden="true"
          />
          <span className="agent-doing__label">{t("agent_page.doing.current")}</span>
        </span>
        <span className="agent-doing__text">{props.doing}</span>
      </div>
    );
  }
  return (
    <BatchTaskSummary
      class_name="agent-translation-status"
      variant="card"
      open_tooltip_on_start={false}
      display={summary}
      completion_percent={metrics.completion_percent}
      on_open={task.open_task_detail_sheet}
    />
  );
}
