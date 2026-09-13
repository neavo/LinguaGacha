import { useProjectTranslationStats } from "@frontend/app/session/project-translation-stats-context";
import { useI18n } from "@frontend/app/locale/locale-provider";
import { useBatchTranslationSession } from "@frontend/app/session/batch-translation/batch-translation-session-context";
import { build_translation_task_summary_display } from "@frontend/features/batch-translation/batch-translation-display";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
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
    <div className="agent-translation-status">
      {/* 进度与详情按钮为同级元素，分别保留数值和交互语义。 */}
      {stats !== null ? (
        <div
          className="agent-translation-status__progress"
          role="progressbar"
          aria-label={display.status_text}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={stats.completion_percent}
        >
          <span
            className="agent-translation-status__fill"
            style={{ transform: `scaleX(${stats.completion_percent / 100})` }}
          />
        </div>
      ) : null}
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="agent-translation-status__button"
              onClick={task.open_translation_detail_sheet}
            >
              <span
                className={`agent-status-mark agent-status-mark--running agent-status-mark--${display.tone}`}
                aria-hidden="true"
              />
              <span className="agent-translation-status__content">
                <span className="agent-translation-status__label">{display.status_text}</span>
                <span className="agent-translation-status__speed">
                  <span className="agent-translation-status__separator"> · </span>
                  {display.speed_text}
                </span>
              </span>
            </button>
          }
        />
        <TooltipContent side="top" sideOffset={8} className="whitespace-pre-line">
          {display.detail_tooltip_text}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
