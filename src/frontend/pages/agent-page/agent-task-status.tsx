import { useI18n } from "@frontend/app/locale/locale-provider";
import { useBatchTranslationSession } from "@frontend/app/session/batch-translation/batch-translation-session-context";
import { build_translation_task_summary_display } from "@frontend/features/batch-translation/batch-translation-display";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import { AgentTodo } from "./agent-todo";

/** 翻译活跃时占用 Todo 状态位，终态恢复会话保留的 Todo。 */
export function AgentTaskStatus(props: {
  todos: readonly string[];
  running: boolean;
}): JSX.Element | null {
  const { t } = useI18n();
  const { batch_translation_task: task } = useBatchTranslationSession();
  const metrics = task.translation_task_metrics;
  if (!metrics.active) return <AgentTodo {...props} />;
  const display = build_translation_task_summary_display(
    metrics,
    t,
    task.translation_task_display_snapshot?.config,
  );
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className="agent-todo agent-todo--translation"
            onClick={task.open_translation_detail_sheet}
          >
            <span
              className={`agent-status-mark agent-status-mark--running ${metrics.stopping ? "agent-status-mark--warning" : "agent-status-mark--success"}`}
              aria-hidden="true"
            />
            <span className="agent-todo__item">
              <span>{display.status_text}</span>
              <span className="agent-todo__speed">{display.trailing_text}</span>
            </span>
          </button>
        }
      />
      <TooltipContent side="top" sideOffset={8} className="whitespace-pre-line">
        {display.detail_tooltip_text}
      </TooltipContent>
    </Tooltip>
  );
}
