import type { JSX } from "react";
import { ChevronsDownUp, Wrench } from "lucide-react";
import type {
  AgentToolEntry,
  AgentContextCompactionEntry as ContextCompactionEntry,
} from "@shared/agent";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-context";
import { AppButton } from "@frontend/widgets/app-button";
import { AGENT_STATUS_LABEL_KEYS, useAgentElapsed } from "./agent-entry-status";
import { AgentStatusMark } from "./agent-status-mark";
import { format_agent_tool_label } from "./agent-tool-label";

/** 压缩使用完整状态句，辅助状态标签复用可见文案。 */
const AGENT_COMPACTION_LABEL_KEYS: Readonly<Record<ContextCompactionEntry["status"], LocaleKey>> =
  Object.freeze({
    running: "agent_page.compaction.running",
    success: "agent_page.compaction.success",
    error: "agent_page.compaction.error",
  });

/** 工具行保留原生按钮语义，完整载荷由时间线唯一详情弹窗展示。 */
export function AgentToolEntryButton(props: {
  entry: AgentToolEntry;
  on_open: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const label = format_agent_tool_label(props.entry.toolName, props.entry.input);
  const active = props.entry.status === "running";
  const duration = useAgentElapsed(props.entry.createdAt, active);
  return (
    <button
      type="button"
      className="agent-process-entry agent-process-entry--tool"
      data-status={props.entry.status}
      aria-haspopup="dialog"
      onClick={props.on_open}
    >
      <Wrench className="agent-process-entry__icon" aria-hidden="true" />
      <span className="agent-process-entry__label" title={label}>
        {label}
      </span>
      <span className="agent-process-entry__accessory">
        {active ? <span className="agent-process-entry__elapsed"> · {duration}</span> : null}
      </span>
      <AgentStatusMark
        status={props.entry.status}
        label={t(AGENT_STATUS_LABEL_KEYS[props.entry.status])}
      />
    </button>
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
  const label = t(AGENT_COMPACTION_LABEL_KEYS[props.entry.status]);
  const show_retry = props.latest && props.entry.status === "error";
  return (
    <div className="agent-process-entry" data-status={props.entry.status}>
      <ChevronsDownUp className="agent-process-entry__icon" aria-hidden="true" />
      <span className="agent-process-entry__label" role="status" title={label}>
        {label}
      </span>
      <span className="agent-process-entry__accessory">
        {show_retry ? (
          <AppButton
            type="button"
            size="xs"
            variant="ghost"
            disabled={!props.compact_available}
            onClick={props.on_compact}
          >
            {t("app.action.retry")}
          </AppButton>
        ) : null}
      </span>
      <AgentStatusMark status={props.entry.status} label={label} />
    </div>
  );
}
