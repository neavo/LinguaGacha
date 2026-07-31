import { memo, useEffect, useRef, useState, type ReactNode, type UIEvent } from "react";
import { Bot } from "lucide-react";

import type { AgentEntry, AgentSessionState, AgentUserMessagePart } from "@shared/agent";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-provider";
import { useModelSelection } from "@frontend/features/model-selection/use-model-selection";
import { useRuntimeSnapshot } from "@frontend/app/state/use-desktop-state";
import { is_runtime_busy } from "@frontend/app/state/runtime-activity-store";
import type { ScreenComponentProps } from "@frontend/app/navigation/types";
import { AppAlertDialog } from "@frontend/widgets/app-alert-dialog";
import { AgentComposer } from "./agent-composer";
import { AgentMarkdown } from "./agent-markdown";
import { useAgentPageState } from "./use-agent-page-state";
import "./agent-page.css";

type Translate = ReturnType<typeof useI18n>["t"];
type UserEntry = Extract<AgentEntry, { kind: "user_message" }>;
type AssistantEntry = Extract<AgentEntry, { kind: "assistant_message" }>;
type ToolEntry = Extract<AgentEntry, { kind: "tool_call" }>;
type DetailStatus = ToolEntry["status"];

/** 工具与思考详情共享同一状态文案词表。 */
const AGENT_STATUS_LABEL_KEYS: Readonly<Record<DetailStatus, LocaleKey>> = Object.freeze({
  running: "agent_page.status.running",
  success: "agent_page.status.success",
  error: "agent_page.status.error",
});

type AgentDetailEntryProps = {
  label: string;
  started_at: number;
  status: DetailStatus;
  active: boolean;
  status_label: string;
} & ({ kind: "thinking"; content: string | null } | { kind: "tool" });

type AgentStatusLightProps = {
  status: DetailStatus;
  active: boolean;
  label: string;
};

/** 渲染 Agent 对话、能力选择与命令输入；会话事实由 useAgentPageState 统一提供。 */
export function AgentPage(_props: ScreenComponentProps): JSX.Element {
  const { t } = useI18n();
  const agent = useAgentPageState();
  const model_selection = useModelSelection();
  const runtime_snapshot = useRuntimeSnapshot();
  const message_end_ref = useRef<HTMLDivElement | null>(null);
  const auto_follow_ref = useRef(true); // 用户主动离开底部后，流式增量不得抢回滚动位置
  const [reset_dialog_open, set_reset_dialog_open] = useState(false);
  const is_running = agent.state === "running";

  useEffect(() => {
    if (auto_follow_ref.current) message_end_ref.current?.scrollIntoView({ block: "end" });
  }, [agent.entries, agent.state]);

  const send = (parts: readonly AgentUserMessagePart[]): Promise<boolean> => {
    auto_follow_ref.current = true;
    return agent.send(parts);
  };

  return (
    <div className="agent-page page-shell page-shell--full">
      <section
        className="agent-page__conversation"
        aria-label={t("agent_page.title")}
        aria-live="polite"
        onScroll={(event: UIEvent<HTMLElement>) => {
          const target = event.currentTarget;
          auto_follow_ref.current =
            target.scrollHeight - target.scrollTop - target.clientHeight < 80;
        }}
      >
        {agent.loading ? (
          <div className="agent-page__empty" role="status">
            <Bot aria-hidden="true" />
            <p>{t("agent_page.loading")}</p>
          </div>
        ) : agent.entries.length === 0 ? (
          <div className="agent-page__empty">
            <Bot aria-hidden="true" />
            <p className="agent-page__empty-message">{t("agent_page.empty.message")}</p>
          </div>
        ) : (
          <div className="agent-page__messages">
            {render_conversation(agent.entries, agent.state, t)}
          </div>
        )}
        <div ref={message_end_ref} />
      </section>

      <AgentComposer
        skills={agent.skills}
        running={is_running}
        runtime_busy={is_runtime_busy(runtime_snapshot)}
        error={agent.error}
        can_reset={!agent.loading && agent.entries.length > 0}
        resetting={agent.resetting}
        context_usage={agent.contextUsage}
        model_selection={model_selection}
        on_send={send}
        on_stop={agent.stop}
        on_reset={() => set_reset_dialog_open(true)}
      />
      <AppAlertDialog
        open={reset_dialog_open}
        description={t("agent_page.confirm.new_task")}
        submitting={agent.resetting}
        onConfirm={async () => {
          if (await agent.reset()) set_reset_dialog_open(false);
        }}
        onClose={() => set_reset_dialog_open(false)}
      />
    </div>
  );
}

/** 单次顺序遍历后端时间线，保持 user、assistant 与 tool 的公开事件次序。 */
function render_conversation(
  entries: readonly AgentEntry[],
  state: AgentSessionState,
  t: Translate,
): ReactNode[] {
  const last_entry = state === "running" ? entries.at(-1) : undefined;
  return entries.map((entry) => (
    <AgentEntryView
      key={entry.id}
      entry={entry}
      active={
        entry.kind === "tool_call"
          ? state === "running" && entry.status === "running"
          : last_entry === entry && entry.kind === "assistant_message" && !entry.complete
      }
      t={t}
    />
  ));
}

/** 后端 upsert 保留未变化条目对象身份，memo 只重绘真实变化的时间线条目。 */
const AgentEntryView = memo(function AgentEntryView(props: {
  entry: AgentEntry;
  active: boolean;
  t: Translate;
}): ReactNode {
  const entry = props.entry;
  if (entry.kind === "tool_call") {
    return (
      <AgentDetailEntry
        kind="tool"
        label={entry.toolName}
        started_at={entry.createdAt}
        status={entry.status}
        active={props.active}
        status_label={props.t(AGENT_STATUS_LABEL_KEYS[entry.status])}
      />
    );
  }
  if (entry.kind === "user_message") {
    return (
      <>
        <AgentRoundHeader user={entry} t={props.t} />
        <article className="agent-message agent-message--user" key={entry.id}>
          <p className="agent-message__user-text">
            {entry.parts.map((part, part_index) =>
              part.kind === "text" ? (
                part.text
              ) : (
                <span className="agent-skill-token" key={`${part.name}-${part_index.toString()}`}>
                  @{part.name}
                </span>
              ),
            )}
          </p>
        </article>
      </>
    );
  }
  return render_assistant_entry(entry, props.active, props.t);
});

/** 保持 text / thinking 的供应商顺序，并只把流式状态标到最后一个开放 part。 */
function render_assistant_entry(
  entry: AssistantEntry,
  active_entry: boolean,
  t: Translate,
): ReactNode {
  if (entry.parts.length === 0) return null;
  return (
    <article className="agent-message agent-message--assistant" key={entry.id}>
      {entry.parts.map((part, part_index) => {
        const key = `${entry.id}-${part_index.toString()}`;
        if (part.kind === "thinking") {
          const active = active_entry && part_index === entry.parts.length - 1;
          const status = active ? "running" : "success";
          return (
            <AgentDetailEntry
              key={key}
              kind="thinking"
              label={t(active ? "agent_page.thinking_active" : "agent_page.thinking")}
              started_at={entry.createdAt}
              status={status}
              active={active}
              status_label={t(AGENT_STATUS_LABEL_KEYS[status])}
              content={part.text}
            />
          );
        }
        return (
          <div className="agent-message__markdown" key={key}>
            <AgentMarkdown text={part.text} complete={entry.complete} />
          </div>
        );
      })}
    </article>
  );
}

/** 每轮只在未结束时持有一个本地时钟；结束时间始终以后端 user 条目为准。 */
function AgentRoundHeader({ user, t }: { user: UserEntry; t: Translate }): JSX.Element {
  const duration = useAgentElapsed(
    user.createdAt,
    user.endedAt === null,
    user.endedAt ?? undefined,
  );
  return (
    <div className="agent-round-header">
      <span aria-hidden="true" />
      <small role="timer" aria-live="off">
        {t(user.endedAt === null ? "agent_page.round.running" : "agent_page.round.ended", {
          duration,
        })}
      </small>
    </div>
  );
}

/** 工具只显示状态行；思考过程保留可展开正文。 */
const AgentDetailEntry = memo(function AgentDetailEntry(props: AgentDetailEntryProps): JSX.Element {
  const duration = useAgentElapsed(props.started_at, props.active);
  if (props.kind === "tool") {
    return (
      <div className="agent-detail-entry agent-detail-entry--tool">
        <span className="agent-detail-entry__label">
          {props.label}
          {props.active && (
            <>
              {" · "}
              <span className="agent-detail-entry__elapsed" role="timer" aria-live="off">
                {duration}
              </span>
            </>
          )}
        </span>
        <AgentStatusLight status={props.status} active={props.active} label={props.status_label} />
      </div>
    );
  }
  return (
    <details className={`agent-detail-entry agent-detail-entry--${props.kind}`}>
      <summary>
        <span className="agent-detail-entry__label">
          {props.label}
          {props.active && (
            <>
              {" · "}
              <span className="agent-detail-entry__elapsed" role="timer" aria-live="off">
                {duration}
              </span>
            </>
          )}
        </span>
        <AgentStatusLight status={props.status} active={props.active} label={props.status_label} />
      </summary>
      {props.content !== null && <pre tabIndex={0}>{props.content}</pre>}
    </details>
  );
});

/** 状态色与动画独立；运行时闪烁所有并行工具或当前思考块。 */
function AgentStatusLight(props: AgentStatusLightProps): JSX.Element {
  return (
    <span
      className={`agent-status-light agent-status-light--${props.status}${props.active ? " agent-status-light--active" : ""}`}
      role="img"
      aria-label={props.label}
    />
  );
}

/** 轮次与当前详情共用同一计时规则；轮次结束时按后端时间冻结。 */
function useAgentElapsed(started_at: number, running: boolean, ended_at?: number): string {
  const [now, set_now] = useState(Date.now);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => set_now(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [running]);

  return format_elapsed((running ? now : (ended_at ?? started_at)) - started_at);
}

/** 轮次耗时使用固定紧凑格式，跨语言文案只负责包裹该稳定数值。 */
function format_elapsed(milliseconds: number): string {
  const total_seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(total_seconds / 3_600);
  const minutes = Math.floor((total_seconds % 3_600) / 60);
  const seconds = total_seconds % 60;
  if (hours > 0) {
    return `${hours.toString()}h ${minutes.toString().padStart(2, "0")}m ${seconds.toString().padStart(2, "0")}s`;
  }
  return minutes > 0
    ? `${minutes.toString()}m ${seconds.toString().padStart(2, "0")}s`
    : `${seconds.toString()}s`;
}
