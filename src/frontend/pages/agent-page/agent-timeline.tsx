import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import type { AgentEntry, AgentSessionState } from "@shared/agent";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-provider";
import { AgentMarkdown } from "./agent-markdown";

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
const AGENT_THINKING_AUTO_COLLAPSE_DELAY_MS = 3_000;

type AgentTimelineProps = {
  entries: readonly AgentEntry[];
  state: AgentSessionState;
};

type AgentDetailDisclosureProps = {
  kind: "tool" | "thinking";
  label: string;
  started_at: number;
  status: DetailStatus;
  active: boolean;
  status_label: string;
  open: boolean;
  on_open_change: (open: boolean) => void;
  on_user_toggle?: () => void;
  children?: ReactNode;
};

type AgentStatusLightProps = {
  status: DetailStatus;
  active: boolean;
  label: string;
};

/** 时间线独立拥有条目次序、详情状态与运行指示，页面只负责滚动和命令入口。 */
export function AgentTimeline(props: AgentTimelineProps): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="agent-page__messages">
      {render_conversation(props.entries, props.state, t)}
      {props.state === "running" && (
        <div className="agent-message__activity">
          <AgentStatusLight status="running" active label={t(AGENT_STATUS_LABEL_KEYS.running)} />
        </div>
      )}
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
      <AgentToolDetail
        label={entry.toolName}
        started_at={entry.createdAt}
        status={entry.status}
        active={props.active}
        status_label={props.t(AGENT_STATUS_LABEL_KEYS[entry.status])}
        content={entry.output}
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
            <AgentThinkingDetail
              key={key}
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

/** 工具详情只在用户展开时格式化和挂载完整输出。 */
function AgentToolDetail(props: {
  label: string;
  started_at: number;
  status: DetailStatus;
  active: boolean;
  status_label: string;
  content: string | null;
}): JSX.Element {
  const [open, set_open] = useState(false);
  return (
    <AgentDetailDisclosure
      kind="tool"
      label={props.label}
      started_at={props.started_at}
      status={props.status}
      active={props.active}
      status_label={props.status_label}
      open={open}
      on_open_change={set_open}
    >
      {open && props.content !== null && (
        <pre tabIndex={0}>{format_tool_output(props.content)}</pre>
      )}
    </AgentDetailDisclosure>
  );
}

/** 思考详情独立拥有流式跟随、用户接管与完成后的自动收缩。 */
function AgentThinkingDetail(props: {
  label: string;
  started_at: number;
  status: DetailStatus;
  active: boolean;
  status_label: string;
  content: string;
}): JSX.Element {
  const [open, set_open] = useState(props.active);
  const content_ref = useRef<HTMLPreElement | null>(null);
  const previous_active_ref = useRef(props.active);
  const user_toggled_ref = useRef(false);

  useLayoutEffect(() => {
    const content = content_ref.current;
    if (props.active && open && content !== null) content.scrollTop = content.scrollHeight;
  }, [open, props.active, props.content]);

  useEffect(() => {
    const was_active = previous_active_ref.current;
    previous_active_ref.current = props.active;
    if (!was_active || props.active || !open || user_toggled_ref.current) return;
    const timer = window.setTimeout(() => set_open(false), AGENT_THINKING_AUTO_COLLAPSE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [open, props.active]);

  return (
    <AgentDetailDisclosure
      kind="thinking"
      label={props.label}
      started_at={props.started_at}
      status={props.status}
      active={props.active}
      status_label={props.status_label}
      open={open}
      on_open_change={set_open}
      on_user_toggle={() => {
        user_toggled_ref.current = true;
      }}
    >
      <pre ref={content_ref} tabIndex={0}>
        {props.content}
      </pre>
    </AgentDetailDisclosure>
  );
}

/** 详情外观保持无状态，工具与思考只共享稳定的原生 disclosure 结构。 */
function AgentDetailDisclosure(props: AgentDetailDisclosureProps): JSX.Element {
  const duration = useAgentElapsed(props.started_at, props.active);
  return (
    <details
      className={`agent-detail-entry agent-detail-entry--${props.kind}`}
      open={props.open}
      onToggle={(event) => props.on_open_change(event.currentTarget.open)}
    >
      <summary onClick={props.on_user_toggle}>
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
      {props.children}
    </details>
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

/** JSON 工具结果便于人工检查，非 JSON 正文保持模型实际收到的原文。 */
function format_tool_output(output: string): string {
  try {
    return JSON.stringify(JSON.parse(output) as unknown, null, 2) ?? output;
  } catch {
    return output;
  }
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
