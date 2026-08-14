import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronsDownUp, CircleAlert, Pencil, RefreshCw } from "lucide-react";

import type { AgentEntry, AgentEntryStatus, AgentToolEntry } from "@shared/agent";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-provider";
import {
  find_agent_mention_ranges,
  type AgentMentionRange,
  type AgentMentionToken,
} from "./agent-mention";
import { AgentMarkdown } from "./agent-markdown";
import { AGENT_STATUS_LABEL_KEYS, AgentStatusMark, useAgentElapsed } from "./agent-entry-status";
import { is_at_scroll_end } from "./agent-scroll";
import { AgentToolDetailDialog } from "./agent-tool-detail-dialog";

type Translate = ReturnType<typeof useI18n>["t"];
type UserEntry = Extract<AgentEntry, { kind: "user_message" }>;
type AssistantEntry = Extract<AgentEntry, { kind: "assistant_message" }>;
type ContextCompactionEntry = Extract<AgentEntry, { kind: "context_compaction" }>;
type AgentRoundEntry = AssistantEntry | AgentToolEntry | ContextCompactionEntry;
type AgentRoundEntries = {
  user: UserEntry;
  entries: AgentRoundEntry[];
};

/** 轮次尾标只包装持续时间，状态对应的完整句式由本地化词表拥有。 */
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
  on_retry: (user: UserEntry) => void;
  on_continue: () => void;
  on_edit: (entry: UserEntry | AssistantEntry) => void;
  revision_disabled: boolean;
  continue_disabled: boolean;
};

/** 时间线独立拥有条目次序、详情状态与运行指示，页面只负责滚动和命令入口。 */
export function AgentTimeline(props: AgentTimelineProps): JSX.Element {
  const { t } = useI18n();
  const [selected_tool_id, set_selected_tool_id] = useState<string | null>(null);
  const rounds = group_agent_rounds(props.entries);
  // 未解决的压缩失败冻结消息改写，只保留原位压缩恢复入口。
  const revision_blocked = props.entries.some(
    (entry) => entry.kind === "context_compaction" && entry.status === "error",
  );
  const selected_tool =
    props.entries.find(
      (entry): entry is AgentToolEntry =>
        entry.kind === "tool_call" && entry.id === selected_tool_id,
    ) ?? null;
  return (
    <>
      <div className="agent-page__messages">
        {rounds.map((round, index) => (
          <AgentRound
            key={round.user.id}
            round={round}
            mention_tokens={props.mention_tokens}
            t={t}
            resume_revision={props.resume_revision}
            on_follow_hold_change={props.on_follow_hold_change}
            revision_available={index === rounds.length - 1 && !revision_blocked}
            on_retry={props.on_retry}
            on_continue={props.on_continue}
            on_edit={props.on_edit}
            revision_disabled={props.revision_disabled}
            continue_disabled={props.continue_disabled}
            on_open_tool={set_selected_tool_id}
          />
        ))}
      </div>
      {selected_tool === null ? null : (
        <AgentToolDetailDialog entry={selected_tool} on_close={() => set_selected_tool_id(null)} />
      )}
    </>
  );
}

/** user 条目是公开轮次边界；页面只做一次顺序分组，不建立第二套状态。 */
function group_agent_rounds(entries: readonly AgentEntry[]): AgentRoundEntries[] {
  const rounds: AgentRoundEntries[] = [];
  for (const entry of entries) {
    if (entry.kind === "user_message") {
      rounds.push({ user: entry, entries: [] });
      continue;
    }
    const round = rounds.at(-1);
    if (round === undefined) {
      throw new Error(`Agent timeline entry ${entry.id} has no owning user round.`);
    }
    round.entries.push(entry);
  }
  return rounds;
}

/** 轮次统一拥有用户消息、公开条目、恢复入口与最终状态。 */
function AgentRound(props: {
  round: AgentRoundEntries;
  mention_tokens: readonly AgentMentionToken[];
  t: Translate;
  resume_revision: number;
  on_follow_hold_change: (id: string, paused: boolean) => void;
  revision_available: boolean;
  on_retry: (user: UserEntry) => void;
  on_continue: () => void;
  on_edit: (entry: UserEntry | AssistantEntry) => void;
  revision_disabled: boolean;
  continue_disabled: boolean;
  on_open_tool: (id: string) => void;
}): JSX.Element {
  const { user, entries } = props.round;
  const mention_ranges = find_agent_mention_ranges(user.text, props.mention_tokens);
  const mention_only =
    mention_ranges.length === 1 &&
    mention_ranges[0]?.from === 0 &&
    mention_ranges[0]?.to === user.text.length;
  const revision_available = props.revision_available && user.status !== "running";
  const show_failure_continue = revision_available && user.status === "error";
  const latest_output = entries.findLast(
    (entry): entry is AssistantEntry => entry.kind === "assistant_message",
  );
  const retry_message_id =
    revision_available && !show_failure_continue ? (latest_output?.id ?? user.id) : null;
  return (
    <>
      <AgentMessageFrame
        role="user"
        actions={
          revision_available ? (
            <AgentMessageActions
              entry={user}
              t={props.t}
              retry={retry_message_id === user.id}
              disabled={props.revision_disabled}
              on_edit={props.on_edit}
              on_retry={() => props.on_retry(user)}
            />
          ) : null
        }
      >
        <article
          className="agent-message agent-message--user"
          data-mention-only={mention_only || undefined}
        >
          {user.images.length > 0 ? (
            <div className="agent-message__user-images">
              {user.images.map((image, index) => (
                <img key={index} src={`data:image/webp;base64,${image}`} alt="" decoding="async" />
              ))}
            </div>
          ) : null}
          {user.text === "" ? null : (
            <p className="agent-message__user-text">
              {render_agent_mention_text(user.text, mention_ranges)}
            </p>
          )}
        </article>
      </AgentMessageFrame>
      {entries.map((entry) => {
        const view = (
          <AgentEntryView
            key={entry.id}
            entry={entry}
            t={props.t}
            resume_revision={props.resume_revision}
            on_follow_hold_change={props.on_follow_hold_change}
            on_continue={props.on_continue}
            continue_disabled={props.continue_disabled}
            on_open_tool={props.on_open_tool}
          />
        );
        if (entry.kind !== "assistant_message") return view;
        const editable = revision_available && entry.id === latest_output?.id;
        return (
          <AgentMessageFrame
            key={entry.id}
            role="assistant"
            actions={
              editable ? (
                <AgentMessageActions
                  entry={entry}
                  t={props.t}
                  retry={retry_message_id === entry.id}
                  disabled={props.revision_disabled}
                  on_edit={props.on_edit}
                  on_retry={() => props.on_retry(user)}
                />
              ) : null
            }
          >
            {view}
          </AgentMessageFrame>
        );
      })}
      {show_failure_continue ? (
        <AgentContinueEntry
          label={props.t("app.error.model.provider_failed.message")}
          action_label={props.t("agent_page.action.continue")}
          disabled={props.continue_disabled}
          on_continue={props.on_continue}
        />
      ) : null}
      <AgentRoundFooter user={user} t={props.t} />
    </>
  );
}

/** 消息容器统一拥有角色对齐与操作归属，工具和轮次状态不进入该结构。 */
function AgentMessageFrame(props: {
  role: "user" | "assistant";
  actions: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className={`agent-message-frame agent-message-frame--${props.role}`}>
      {props.children}
      {props.actions}
    </div>
  );
}

/** 修改归属具体消息；重试按需挂到输入或最终输出。 */
function AgentMessageActions(props: {
  entry: UserEntry | AssistantEntry;
  t: Translate;
  retry: boolean;
  disabled: boolean;
  on_edit: (entry: UserEntry | AssistantEntry) => void;
  on_retry: () => void;
}): JSX.Element {
  return (
    <div className="agent-message-actions">
      <button type="button" disabled={props.disabled} onClick={() => props.on_edit(props.entry)}>
        <Pencil aria-hidden="true" />
        <span>
          {props.t(
            props.entry.kind === "user_message"
              ? "agent_page.action.edit_and_retry"
              : "agent_page.action.edit",
          )}
        </span>
      </button>
      {props.retry ? (
        <button type="button" disabled={props.disabled} onClick={props.on_retry}>
          <RefreshCw aria-hidden="true" />
          <span>{props.t("agent_page.action.retry")}</span>
        </button>
      ) : null}
    </div>
  );
}

/** 所有尾部失败共用整块“继续”入口，具体步骤由后端权威状态决定。 */
function AgentContinueEntry(props: {
  label: string;
  action_label: string;
  disabled: boolean;
  on_continue: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className="agent-continue-entry"
      disabled={props.disabled}
      onClick={props.on_continue}
    >
      <CircleAlert aria-hidden="true" />
      <span>{props.label}</span>
      <span className="agent-continue-entry__action">{props.action_label}</span>
    </button>
  );
}

/** 后端 upsert 保留未变化条目对象身份，memo 只重绘真实变化的时间线条目。 */
const AgentEntryView = memo(function AgentEntryView(props: {
  entry: AgentRoundEntry;
  t: Translate;
  resume_revision: number;
  on_follow_hold_change: (id: string, paused: boolean) => void;
  on_continue: () => void;
  continue_disabled: boolean;
  on_open_tool: (id: string) => void;
}): ReactNode {
  const entry = props.entry;
  if (entry.kind === "context_compaction") {
    return (
      <AgentContextCompactionEntry
        entry={entry}
        t={props.t}
        disabled={props.continue_disabled}
        on_continue={props.on_continue}
      />
    );
  }
  if (entry.kind === "tool_call") {
    return (
      <AgentToolEntryButton
        entry={entry}
        status_label={props.t(AGENT_STATUS_LABEL_KEYS[entry.status])}
        on_open={() => props.on_open_tool(entry.id)}
      />
    );
  }
  return render_assistant_entry(entry, props.t, props.resume_revision, props.on_follow_hold_change);
});

/** 压缩是无详情的模型历史边界；失败时整条成为唯一恢复入口。 */
function AgentContextCompactionEntry(props: {
  entry: ContextCompactionEntry;
  t: Translate;
  disabled: boolean;
  on_continue: () => void;
}): JSX.Element {
  const label = props.t(AGENT_COMPACTION_LABEL_KEYS[props.entry.status]);
  if (props.entry.status === "error") {
    return (
      <AgentContinueEntry
        label={label}
        action_label={props.t("agent_page.action.continue")}
        disabled={props.disabled}
        on_continue={props.on_continue}
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
        return <AgentMarkdown key={key} text={part.text} streaming={entry.status === "running"} />;
      })}
    </article>
  );
}

/** 工具条目只展示可扫描摘要，完整载荷交给页面唯一详情弹窗。 */
function AgentToolEntryButton(props: {
  entry: AgentToolEntry;
  status_label: string;
  on_open: () => void;
}): JSX.Element {
  const active = props.entry.status === "running";
  const duration = useAgentElapsed(props.entry.createdAt, active);
  return (
    <button
      type="button"
      className="agent-tool-entry"
      aria-haspopup="dialog"
      onClick={props.on_open}
    >
      <span className="agent-tool-entry__label">
        {props.entry.toolName}
        {active ? (
          <>
            {" · "}
            <span className="agent-tool-entry__elapsed">{duration}</span>
          </>
        ) : null}
      </span>
      <AgentStatusMark status={props.entry.status} label={props.status_label} />
    </button>
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

  const duration = useAgentElapsed(props.started_at, active);
  return (
    <details
      className="agent-thinking-entry"
      open={open}
      onToggle={(event) => {
        const next_open = event.currentTarget.open;
        set_open(next_open);
        if (!next_open) props.on_follow_hold_change(props.id, false);
      }}
    >
      <summary
        onClick={() => {
          user_toggled_ref.current = true;
        }}
      >
        <span className="agent-thinking-entry__label">
          {props.label}
          {active ? (
            <>
              {" · "}
              <span className="agent-thinking-entry__elapsed">{duration}</span>
            </>
          ) : null}
        </span>
        <AgentStatusMark status={props.status} label={props.status_label} />
      </summary>
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
    </details>
  );
}

/** 每轮只在未结束时持有一个本地时钟；结束时间始终以后端 user 条目为准。 */
function AgentRoundFooter({ user, t }: { user: UserEntry; t: Translate }): JSX.Element {
  const active = user.status === "running";
  const duration = useAgentElapsed(user.createdAt, active, user.endedAt ?? undefined);
  return (
    <div className="agent-round-footer" data-running={active || undefined}>
      <div className="agent-round-footer__running" aria-hidden={!active}>
        <span className="agent-round-footer__activity" aria-hidden="true" />
        <small>{t(AGENT_ROUND_LABEL_KEYS.running, { duration })}</small>
      </div>
      <div className="agent-round-footer__result" aria-hidden={active}>
        <span className="agent-round-footer__line" aria-hidden="true" />
        <small>{t(AGENT_ROUND_LABEL_KEYS[user.status], { duration })}</small>
      </div>
    </div>
  );
}
