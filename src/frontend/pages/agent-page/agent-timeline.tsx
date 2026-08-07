import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronsDownUp, CircleAlert } from "lucide-react";

import type { AgentEntry, AgentEntryStatus } from "@shared/agent";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-provider";
import {
  find_agent_mention_ranges,
  type AgentMentionRange,
  type AgentMentionToken,
} from "./agent-mention";
import { AgentMarkdown } from "./agent-markdown";
import { is_at_scroll_end } from "./agent-scroll";

type Translate = ReturnType<typeof useI18n>["t"];
type UserEntry = Extract<AgentEntry, { kind: "user_message" }>;
type AssistantEntry = Extract<AgentEntry, { kind: "assistant_message" }>;
type ContextCompactionEntry = Extract<AgentEntry, { kind: "context_compaction" }>;

/** 工具与思考详情共享同一状态文案词表。 */
const AGENT_STATUS_LABEL_KEYS: Readonly<Record<AgentEntryStatus, LocaleKey>> = Object.freeze({
  running: "agent_page.status.running",
  success: "agent_page.status.success",
  error: "agent_page.status.error",
  stopped: "agent_page.status.stopped",
});
/** 轮次头只包装持续时间，状态对应的完整句式由本地化词表拥有。 */
const AGENT_ROUND_LABEL_KEYS: Readonly<Record<AgentEntryStatus, LocaleKey>> = Object.freeze({
  running: "agent_page.round.running",
  success: "agent_page.round.success",
  error: "agent_page.round.error",
  stopped: "agent_page.round.stopped",
});
const AGENT_COMPACTION_LABEL_KEYS: Readonly<Record<ContextCompactionEntry["status"], LocaleKey>> =
  Object.freeze({
    running: "agent_page.compaction.running",
    success: "agent_page.compaction.success",
    error: "agent_page.compaction.error",
  });
const AGENT_THINKING_AUTO_COLLAPSE_DELAY_MS = 3_000; // 给用户留出确认终态的短暂视觉窗口

type AgentTimelineProps = {
  entries: readonly AgentEntry[];
  mention_tokens: readonly AgentMentionToken[];
  resume_revision: number;
  on_follow_hold_change: (id: string, paused: boolean) => void;
  on_retry: (text: string) => void;
  on_compaction_retry: () => void;
  message_retry_disabled: boolean;
  compaction_retry_disabled: boolean;
};

type AgentDetailDisclosureProps = {
  kind: "tool" | "thinking";
  label: string;
  started_at: number;
  status: AgentEntryStatus;
  status_label: string;
  open: boolean;
  on_open_change: (open: boolean) => void;
  on_user_toggle?: () => void;
  children?: ReactNode;
};

type AgentStatusMarkProps = {
  status: AgentEntryStatus;
  label: string;
};

/** 时间线独立拥有条目次序、详情状态与运行指示，页面只负责滚动和命令入口。 */
export function AgentTimeline(props: AgentTimelineProps): JSX.Element {
  const { t } = useI18n();
  const show_activity = should_show_trailing_activity(props.entries);
  return (
    <div className="agent-page__messages">
      {render_conversation(
        props.entries,
        props.mention_tokens,
        t,
        props.resume_revision,
        props.on_follow_hold_change,
        props.on_retry,
        props.on_compaction_retry,
        props.message_retry_disabled,
        props.compaction_retry_disabled,
      )}
      {show_activity && (
        <div className="agent-message__activity">
          <AgentStatusMark status="running" label={t(AGENT_STATUS_LABEL_KEYS.running)} />
        </div>
      )}
    </div>
  );
}

/** 单次顺序遍历后端时间线，保持 user、assistant 与 tool 的公开事件次序。 */
function render_conversation(
  entries: readonly AgentEntry[],
  mention_tokens: readonly AgentMentionToken[],
  t: Translate,
  resume_revision: number,
  on_follow_hold_change: (id: string, paused: boolean) => void,
  on_retry: (text: string) => void,
  on_compaction_retry: () => void,
  message_retry_disabled: boolean,
  compaction_retry_disabled: boolean,
): ReactNode[] {
  const content: ReactNode[] = [];
  let current_user: UserEntry | null = null;
  let current_round_has_compaction = false;
  for (const entry of entries) {
    if (entry.kind === "user_message") {
      if (current_user?.status === "error" && !current_round_has_compaction) {
        const failed_user = current_user;
        content.push(
          <AgentRetryEntry
            key={`error:${failed_user.id}`}
            label={t("app.error.model.provider_failed.message")}
            retry_label={t("agent_page.action.click_to_retry")}
            disabled={message_retry_disabled}
            on_retry={() => on_retry(failed_user.text)}
          />,
        );
      }
      current_user = entry;
      current_round_has_compaction = false;
    }
    if (entry.kind === "context_compaction") current_round_has_compaction = true;
    content.push(
      <AgentEntryView
        key={entry.id}
        entry={entry}
        mention_tokens={mention_tokens}
        t={t}
        resume_revision={resume_revision}
        on_follow_hold_change={on_follow_hold_change}
        on_compaction_retry={on_compaction_retry}
        compaction_retry_disabled={compaction_retry_disabled}
      />,
    );
  }
  if (current_user?.status === "error" && !current_round_has_compaction) {
    const failed_user = current_user;
    content.push(
      <AgentRetryEntry
        key={`error:${failed_user.id}`}
        label={t("app.error.model.provider_failed.message")}
        retry_label={t("agent_page.action.click_to_retry")}
        disabled={message_retry_disabled}
        on_retry={() => on_retry(failed_user.text)}
      />,
    );
  }
  return content;
}

/** 两类失败共用整块恢复入口，文本区分错误，点击行为由各自状态拥有者决定。 */
function AgentRetryEntry(props: {
  label: string;
  retry_label: string;
  disabled: boolean;
  on_retry: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className="agent-retry-entry"
      disabled={props.disabled}
      onClick={props.on_retry}
    >
      <CircleAlert aria-hidden="true" />
      <span>{props.label}</span>
      <span className="agent-retry-entry__action">{props.retry_label}</span>
    </button>
  );
}

/** 后端 upsert 保留未变化条目对象身份，memo 只重绘真实变化的时间线条目。 */
const AgentEntryView = memo(function AgentEntryView(props: {
  entry: AgentEntry;
  mention_tokens: readonly AgentMentionToken[];
  t: Translate;
  resume_revision: number;
  on_follow_hold_change: (id: string, paused: boolean) => void;
  on_compaction_retry: () => void;
  compaction_retry_disabled: boolean;
}): ReactNode {
  const entry = props.entry;
  if (entry.kind === "context_compaction") {
    return (
      <AgentContextCompactionEntry
        entry={entry}
        t={props.t}
        disabled={props.compaction_retry_disabled}
        on_retry={props.on_compaction_retry}
      />
    );
  }
  if (entry.kind === "tool_call") {
    return (
      <AgentToolDetail
        id={`tool:${entry.id}`}
        label={entry.toolName}
        started_at={entry.createdAt}
        status={entry.status}
        status_label={props.t(AGENT_STATUS_LABEL_KEYS[entry.status])}
        content={entry.output}
        resume_revision={props.resume_revision}
        on_follow_hold_change={props.on_follow_hold_change}
      />
    );
  }
  if (entry.kind === "user_message") {
    const mention_ranges = find_agent_mention_ranges(entry.text, props.mention_tokens);
    const mention_only =
      mention_ranges.length === 1 &&
      mention_ranges[0]?.from === 0 &&
      mention_ranges[0]?.to === entry.text.length;
    return (
      <>
        <AgentRoundHeader user={entry} t={props.t} />
        <article
          className="agent-message agent-message--user"
          data-mention-only={mention_only || undefined}
          key={entry.id}
        >
          <p className="agent-message__user-text">
            {render_agent_mention_text(entry.text, mention_ranges)}
          </p>
        </article>
      </>
    );
  }
  return render_assistant_entry(entry, props.t, props.resume_revision, props.on_follow_hold_change);
});

/** 压缩是无详情的模型历史边界；失败时整条成为唯一恢复入口。 */
function AgentContextCompactionEntry(props: {
  entry: ContextCompactionEntry;
  t: Translate;
  disabled: boolean;
  on_retry: () => void;
}): JSX.Element {
  const label = props.t(AGENT_COMPACTION_LABEL_KEYS[props.entry.status]);
  if (props.entry.status === "error") {
    return (
      <AgentRetryEntry
        label={label}
        retry_label={props.t("agent_page.action.click_to_retry")}
        disabled={props.disabled}
        on_retry={props.on_retry}
      />
    );
  }
  return (
    <div className="agent-context-compaction" role="status">
      <ChevronsDownUp aria-hidden="true" />
      <span>{label}</span>
      <AgentStatusMark status={props.entry.status} label={label} />
    </div>
  );
}

/** 用已知非重叠范围渲染用户正文；未知 marker 与普通文本保持原样。 */
function render_agent_mention_text(
  text: string,
  ranges: readonly AgentMentionRange[],
): ReactNode[] {
  const content: ReactNode[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.from > cursor) content.push(text.slice(cursor, range.from));
    content.push(
      <span className="agent-mention-token" key={`${range.from.toString()}:${range.marker}`}>
        <span>{range.marker}</span>
      </span>,
    );
    cursor = range.to;
  }
  if (cursor < text.length) content.push(text.slice(cursor));
  return content;
}

/** 保持 text / thinking 的供应商顺序，并只把流式状态标到最后一个开放 part。 */
function render_assistant_entry(
  entry: AssistantEntry,
  t: Translate,
  resume_revision: number,
  on_follow_hold_change: (id: string, paused: boolean) => void,
): ReactNode {
  if (entry.parts.length === 0) return null;
  return (
    <article className="agent-message agent-message--assistant" key={entry.id}>
      {entry.parts.map((part, part_index) => {
        const key = `${entry.id}-${part_index.toString()}`;
        if (part.kind === "thinking") {
          const status = part_index === entry.parts.length - 1 ? entry.status : "success";
          return (
            <AgentThinkingDetail
              key={key}
              id={`thinking:${key}`}
              label={t(status === "running" ? "agent_page.thinking_active" : "agent_page.thinking")}
              started_at={entry.createdAt}
              status={status}
              status_label={t(AGENT_STATUS_LABEL_KEYS[status])}
              content={part.text}
              resume_revision={resume_revision}
              on_follow_hold_change={on_follow_hold_change}
            />
          );
        }
        return (
          <div className="agent-message__markdown" key={key}>
            <AgentMarkdown text={part.text} streaming={entry.status === "running"} />
          </div>
        );
      })}
    </article>
  );
}

/** 工具详情只在用户展开时格式化和挂载完整输出。 */
function AgentToolDetail(props: {
  id: string;
  label: string;
  started_at: number;
  status: AgentEntryStatus;
  status_label: string;
  content: string | null;
  resume_revision: number;
  on_follow_hold_change: (id: string, paused: boolean) => void;
}): JSX.Element {
  const [open, set_open] = useState(false);
  const content_ref = useRef<HTMLPreElement | null>(null);
  const previous_resume_revision_ref = useRef(props.resume_revision);

  // “回到最新”同时恢复已展开工具输出，关闭详情则不产生无意义滚动。
  useLayoutEffect(() => {
    if (previous_resume_revision_ref.current === props.resume_revision) return;
    previous_resume_revision_ref.current = props.resume_revision;
    if (!open) return;
    const content = content_ref.current;
    if (content !== null) {
      content.scrollTop = content.scrollHeight;
      props.on_follow_hold_change(props.id, false);
    }
  }, [open, props.id, props.on_follow_hold_change, props.resume_revision]);

  useEffect(
    () => () => props.on_follow_hold_change(props.id, false),
    [props.id, props.on_follow_hold_change],
  );

  return (
    <AgentDetailDisclosure
      kind="tool"
      label={props.label}
      started_at={props.started_at}
      status={props.status}
      status_label={props.status_label}
      open={open}
      on_open_change={(next_open) => {
        set_open(next_open);
        if (!next_open) props.on_follow_hold_change(props.id, false);
      }}
    >
      {open && props.content !== null && (
        <pre
          ref={content_ref}
          tabIndex={0}
          onScroll={(event) =>
            props.on_follow_hold_change(props.id, !is_at_scroll_end(event.currentTarget))
          }
        >
          {format_tool_output(props.content)}
        </pre>
      )}
    </AgentDetailDisclosure>
  );
}

/** 思考详情独立拥有流式跟随、用户接管与完成后的自动收缩。 */
function AgentThinkingDetail(props: {
  id: string;
  label: string;
  started_at: number;
  status: AgentEntryStatus;
  status_label: string;
  content: string;
  resume_revision: number;
  on_follow_hold_change: (id: string, paused: boolean) => void;
}): JSX.Element {
  const active = props.status === "running";
  const [open, set_open] = useState(active);
  const [follow_paused, set_follow_paused] = useState(false);
  const content_ref = useRef<HTMLPreElement | null>(null);
  const follow_paused_ref = useRef(false); // 同步守卫先于 React 状态提交，避免下一帧增量抢回滚动位置
  const user_toggled_ref = useRef(false); // 手动开合始终优先于自动收缩
  const previous_resume_revision_ref = useRef(props.resume_revision);

  // 流式增量只在详情仍跟随时归底，用户一旦上划便保留当前位置。
  useLayoutEffect(() => {
    const content = content_ref.current;
    if (active && open && !follow_paused_ref.current && content !== null) {
      content.scrollTop = content.scrollHeight;
    }
  }, [active, open, props.content]);

  // 显式“回到最新”覆盖所有阅读暂停，并让完成后的自动收缩重新获得资格。
  useLayoutEffect(() => {
    if (previous_resume_revision_ref.current === props.resume_revision) return;
    previous_resume_revision_ref.current = props.resume_revision;
    const content = content_ref.current;
    if (content === null) return;
    content.scrollTop = content.scrollHeight;
    follow_paused_ref.current = false;
    set_follow_paused(false);
    props.on_follow_hold_change(props.id, false);
  }, [props.id, props.on_follow_hold_change, props.resume_revision]);

  useEffect(() => {
    if (active || !open || follow_paused || user_toggled_ref.current) return;
    const timer = window.setTimeout(() => set_open(false), AGENT_THINKING_AUTO_COLLAPSE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [active, follow_paused, open]);

  useEffect(
    () => () => props.on_follow_hold_change(props.id, false),
    [props.id, props.on_follow_hold_change],
  );

  return (
    <AgentDetailDisclosure
      kind="thinking"
      label={props.label}
      started_at={props.started_at}
      status={props.status}
      status_label={props.status_label}
      open={open}
      on_open_change={(next_open) => {
        set_open(next_open);
        if (!next_open) props.on_follow_hold_change(props.id, false);
      }}
      on_user_toggle={() => {
        user_toggled_ref.current = true;
      }}
    >
      <pre
        ref={content_ref}
        tabIndex={0}
        onScroll={(event) => {
          const paused = !is_at_scroll_end(event.currentTarget);
          follow_paused_ref.current = paused;
          set_follow_paused(paused);
          props.on_follow_hold_change(props.id, paused);
        }}
      >
        {props.content}
      </pre>
    </AgentDetailDisclosure>
  );
}

/** 详情外观保持无状态，工具与思考只共享稳定的原生 disclosure 结构。 */
function AgentDetailDisclosure(props: AgentDetailDisclosureProps): JSX.Element {
  const active = props.status === "running";
  const duration = useAgentElapsed(props.started_at, active);
  return (
    <details
      className={`agent-detail-entry agent-detail-entry--${props.kind}`}
      open={props.open}
      onToggle={(event) => props.on_open_change(event.currentTarget.open)}
    >
      <summary onClick={props.on_user_toggle}>
        <span className="agent-detail-entry__label">
          {props.label}
          {active && (
            <>
              {" · "}
              <span className="agent-detail-entry__elapsed" role="timer" aria-live="off">
                {duration}
              </span>
            </>
          )}
        </span>
        <AgentStatusMark status={props.status} label={props.status_label} />
      </summary>
      {props.children}
    </details>
  );
}

/** 每轮只在未结束时持有一个本地时钟；结束时间始终以后端 user 条目为准。 */
function AgentRoundHeader({ user, t }: { user: UserEntry; t: Translate }): JSX.Element {
  const duration = useAgentElapsed(
    user.createdAt,
    user.status === "running",
    user.endedAt ?? undefined,
  );
  return (
    <div className="agent-round-header">
      <span aria-hidden="true" />
      <small role="timer" aria-live="off">
        {t(AGENT_ROUND_LABEL_KEYS[user.status], { duration })}
      </small>
    </div>
  );
}

/** 所有状态复用固定圆形灯，颜色与可访问名称共同表达结果。 */
function AgentStatusMark(props: AgentStatusMarkProps): JSX.Element {
  return (
    <span
      className={`agent-status-mark agent-status-mark--${props.status}`}
      role="img"
      aria-label={props.label}
    />
  );
}

/** 没有可见的运行标记时才补尾部活动标记，避免同一状态重复出现。 */
function should_show_trailing_activity(entries: readonly AgentEntry[]): boolean {
  if (!entries.some((entry) => entry.status === "running")) return false;
  const last = entries.at(-1);
  if (last?.kind === "context_compaction") return last.status !== "running";
  if (last?.kind === "tool_call") return last.status !== "running";
  return !(
    last?.kind === "assistant_message" &&
    last.status === "running" &&
    last.parts.at(-1)?.kind === "thinking"
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
