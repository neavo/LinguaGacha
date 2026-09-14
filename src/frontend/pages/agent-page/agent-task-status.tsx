import { useProjectTranslationStats } from "@frontend/app/session/project-translation-stats-context";
import { useI18n } from "@frontend/app/locale/locale-provider";
import { useBatchTranslationSession } from "@frontend/app/session/batch-translation/batch-translation-session-context";
import { build_translation_task_summary_display } from "@frontend/features/batch-translation/batch-translation-display";
import { BatchTranslationSummary } from "@frontend/features/batch-translation/batch-translation-summary";
import { AgentTodo } from "./agent-todo";
import "./agent-task-status.css";

/** 翻译活跃时占用 Todo 状态位，终态恢复会话保留的 Todo。 */
export function AgentTaskStatus(props: {
  todos: readonly string[];
  running: boolean;
}): JSX.Element | null {
  const { t } = useI18n();
  const { batch_translation_task: task } = useBatchTranslationSession();
  const metrics = task.translation_task_metrics;
  const stats = useProjectTranslationStats();
  const display = build_translation_task_summary_display(metrics, t);
  if (display.speed_text === null) return <AgentTodo {...props} />;
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
