import type { JSX } from "react";
import { useProjectTranslationStats } from "@frontend/app/session/project-translation-stats-context";
import { useI18n } from "@frontend/app/locale/locale-context";
import { useBatchTranslationSession } from "@frontend/app/session/batch-translation/batch-translation-session-context";
import { build_translation_task_summary_display } from "@frontend/features/batch-translation/batch-translation-display";
import { BatchTranslationSummary } from "@frontend/features/batch-translation/batch-translation-summary";
import "./agent-task-status.css";

/** 翻译活跃时占用「正在处理」状态位，终态恢复会话保留的 `doing`。 */
export function AgentTaskStatus(props: {
  doing: string | null;
  running: boolean;
}): JSX.Element | null {
  const { t } = useI18n();
  const { batch_translation_task: task } = useBatchTranslationSession();
  const metrics = task.translation_task_metrics;
  const stats = useProjectTranslationStats();
  const display = build_translation_task_summary_display(metrics, t);
  if (display.speed_text === null) {
    if (props.doing === null) return null;
    return (
      <div className="agent-doing" role="status">
        <span className="agent-doing__lead">
          <span
            className={`agent-status-mark${props.running ? " agent-status-mark--pending agent-status-mark--running" : ""}`}
            aria-hidden="true"
          />
          <span className="agent-doing__label">{t("agent_page.doing.current")}</span>
        </span>
        <span className="agent-doing__text">{props.doing}</span>
      </div>
    );
  }
  return (
    <BatchTranslationSummary
      class_name="agent-translation-status"
      variant="card"
      open_tooltip_on_start={false}
      display={display}
      completion_percent={stats?.completion_percent ?? null}
      on_open={task.open_translation_detail_sheet}
    />
  );
}
