import type { JSX } from "react";
import { ChevronsDownUp, Wrench, type LucideIcon } from "lucide-react";
import type {
  AgentEntryStatus,
  AgentToolEntry,
  AgentContextCompactionEntry as ContextCompactionEntry,
} from "@shared/agent";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-context";
import { AGENT_STATUS_LABEL_KEYS, useAgentElapsed } from "./agent-entry-status";
import { AgentStatusMark } from "./agent-status-mark";
import { format_agent_tool_label } from "./agent-tool-label";

/** 压缩使用完整状态句，辅助状态标签复用可见文案。 */
const AGENT_COMPACTION_LABEL_KEYS: Readonly<Record<ContextCompactionEntry["status"], LocaleKey>> =
  Object.freeze({
    running: "agent_page.compaction.running",
    success: "agent_page.compaction.success",
    error: "agent_page.compaction.error",
    stopped: "agent_page.compaction.stopped",
  });

/** 工具行保留原生按钮语义，完整载荷由时间线唯一详情弹窗展示。 */
export function AgentToolEntryButton(props: {
  entry: AgentToolEntry;
  on_open: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const label = format_agent_tool_label(props.entry.toolName, props.entry.input);
  return (
    <AgentProcessEntry
      icon={Wrench}
      label={label}
      status={props.entry.status}
      status_label={t(AGENT_STATUS_LABEL_KEYS[props.entry.status])}
      created_at={props.entry.createdAt}
      action={{ on_click: props.on_open, has_popup: "dialog" }}
    />
  );
}

/** 重试压缩当前上下文，历史失败条目随更新的压缩身份退出恢复入口。 */
export function AgentContextCompactionEntry(props: {
  entry: ContextCompactionEntry;
  latest: boolean; // 时间线提供最近压缩身份的判断，行组件只负责展示与操作。
  compact_available: boolean;
  on_compact: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const status_label = t(AGENT_COMPACTION_LABEL_KEYS[props.entry.status]);
  const retry = props.latest && props.entry.status === "error";
  const label = retry && props.compact_available ? t("agent_page.compaction.retry") : status_label;
  return (
    <AgentProcessEntry
      icon={ChevronsDownUp}
      label={label}
      status={props.entry.status}
      status_label={status_label}
      created_at={props.entry.createdAt}
      announce_status
      action={retry ? { on_click: props.on_compact, disabled: !props.compact_available } : null}
    />
  );
}

/** 两类过程共用骨架与耗时，业务入口提供整行动作及其原生按钮语义。 */
function AgentProcessEntry(props: {
  icon: LucideIcon;
  label: string;
  status: AgentEntryStatus;
  status_label: string;
  created_at: number | null;
  announce_status?: boolean;
  action: {
    on_click: () => void;
    disabled?: boolean;
    has_popup?: "dialog";
  } | null;
}): JSX.Element {
  const Icon = props.icon;
  const content = (
    <>
      <Icon className="agent-process-entry__icon" aria-hidden="true" />
      <span className="agent-process-entry__content">
        <span
          className="agent-process-entry__label"
          role={props.announce_status ? "status" : undefined}
        >
          {props.label}
        </span>
        {props.status === "running" && props.created_at !== null ? (
          <AgentProcessElapsed created_at={props.created_at} />
        ) : null}
      </span>
      <AgentStatusMark status={props.status} label={props.status_label} />
    </>
  );
  return props.action === null ? (
    <div className="agent-process-entry" data-status={props.status}>
      {content}
    </div>
  ) : (
    <button
      type="button"
      className="agent-process-entry agent-process-entry--interactive"
      data-status={props.status}
      aria-label={props.label}
      aria-haspopup={props.action.has_popup}
      disabled={props.action.disabled}
      onClick={props.action.on_click}
    >
      {content}
    </button>
  );
}

/** 仅运行且有真实起始时间时挂载时钟，终态自动释放计时器。 */
function AgentProcessElapsed(props: { created_at: number }): JSX.Element {
  const duration = useAgentElapsed(props.created_at, true);
  return <span className="agent-process-entry__elapsed"> · {duration}</span>;
}
