import { useI18n } from "@frontend/app/locale/locale-provider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";

type AgentTodoProps = {
  todos: readonly string[];
  running: boolean;
};

/** 当前队首 Todo 贴近输入区展示，完整有序集合由整条触发的提示展开。 */
export function AgentTodo(props: AgentTodoProps): JSX.Element | null {
  const { t } = useI18n();
  const next_item = props.todos[0];
  if (next_item === undefined) return null;
  const remaining_count = props.todos.length - 1;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div className="agent-todo" role="status" tabIndex={0}>
            <span className="agent-todo__lead">
              <span
                className={`agent-status-mark${props.running ? " agent-status-mark--running" : ""}`}
                aria-hidden="true"
              />
              <span className="agent-todo__label">{t("agent_page.todo.pending")}</span>
            </span>
            <span className="agent-todo__item">{next_item}</span>
            {remaining_count === 0 ? null : (
              <span className="agent-todo__more">+{remaining_count.toString()}</span>
            )}
          </div>
        }
      />
      <TooltipContent side="top" sideOffset={8} className="agent-todo__tooltip">
        <ul>
          {props.todos.map((item, index) => (
            <li key={`${index.toString()}:${item}`}>{item}</li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}
