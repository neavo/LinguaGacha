import { useI18n } from "@frontend/app/locale/locale-provider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";

type AgentTaskProgressProps = {
  pending_labels: readonly string[];
  running: boolean;
};

/** 当前队首待办以固定状态条贴近输入区，完整队列由整条触发的提示展开。 */
export function AgentTaskProgress(props: AgentTaskProgressProps): JSX.Element | null {
  const { t } = useI18n();
  const next_item = props.pending_labels[0];
  if (next_item === undefined) return null;
  const remaining_count = props.pending_labels.length - 1;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="agent-task-progress" role="status" tabIndex={0}>
          <span className="agent-task-progress__lead">
            <span
              className="agent-task-progress__spinner"
              data-running={props.running || undefined}
              aria-hidden="true"
            />
            <span className="agent-task-progress__label">{t("agent_page.task_progress.next")}</span>
          </span>
          <span className="agent-task-progress__item">{next_item}</span>
          {remaining_count === 0 ? null : (
            <span className="agent-task-progress__more">+{remaining_count.toString()}</span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8} className="agent-task-progress__tooltip">
        <ul>
          {props.pending_labels.map((item, index) => (
            <li key={`${index.toString()}:${item}`}>{item}</li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}
