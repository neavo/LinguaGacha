import { useEffect, useRef, useState, type ReactNode, type UIEvent } from "react";
import { Bot } from "lucide-react";

import type { AgentEntry, AgentSessionState, AgentUserMessagePart } from "@shared/agent";
import { useI18n } from "@frontend/app/locale/locale-provider";
import { useModelSelection } from "@frontend/features/model-selection/use-model-selection";
import type { ScreenComponentProps } from "@frontend/app/navigation/types";
import { AgentComposer } from "./agent-composer";
import { AgentMarkdown } from "./agent-markdown";
import { useAgentPageState } from "./use-agent-page-state";
import "./agent-page.css";

type Translate = ReturnType<typeof useI18n>["t"];
type UserEntry = Extract<AgentEntry, { kind: "user_message" }>;
type AssistantEntry = Extract<AgentEntry, { kind: "assistant_message" }>;
type ToolEntry = Extract<AgentEntry, { kind: "tool_call" }>;
type DetailStatus = ToolEntry["status"];

type AgentDetailEntryProps = {
  kind: "tool" | "thinking";
  label: string;
  status: DetailStatus;
  content: string | null;
};

/** 渲染 Agent 对话、能力选择与命令输入；会话事实由 useAgentPageState 统一提供。 */
export function AgentPage(_props: ScreenComponentProps): JSX.Element {
  const { t } = useI18n();
  const agent = useAgentPageState();
  const model_selection = useModelSelection();
  const message_end_ref = useRef<HTMLDivElement | null>(null);
  const auto_follow_ref = useRef(true); // 用户主动离开底部后，流式增量不得抢回滚动位置
  const is_running = agent.state === "running";

  useEffect(() => {
    if (auto_follow_ref.current) message_end_ref.current?.scrollIntoView({ block: "end" });
  }, [agent.entries]);

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
        error={agent.error}
        model_selection={model_selection}
        on_send={send}
        on_stop={agent.stop}
      />
    </div>
  );
}

/** 单次顺序遍历后端时间线，保持 user、assistant 与 tool 的公开事件次序。 */
function render_conversation(
  entries: AgentEntry[],
  state: AgentSessionState,
  t: Translate,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  for (const entry of entries) {
    if (entry.kind === "tool_call") {
      nodes.push(
        <AgentDetailEntry
          key={entry.id}
          kind="tool"
          label={entry.toolName}
          status={entry.status}
          content={entry.output === null ? null : format_tool_output(entry.output)}
        />,
      );
      continue;
    }
    if (entry.kind === "user_message") {
      nodes.push(<AgentRoundHeader key={`round-${entry.id}`} user={entry} t={t} />);
      nodes.push(
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
        </article>,
      );
      continue;
    }
    nodes.push(render_assistant_entry(entry, state, t));
  }
  return nodes;
}

/** 保持 text / thinking 的供应商顺序，并只把流式状态标到最后一个开放 part。 */
function render_assistant_entry(
  entry: AssistantEntry,
  state: AgentSessionState,
  t: Translate,
): ReactNode {
  if (entry.parts.length === 0) return null;
  return (
    <article className="agent-message agent-message--assistant" key={entry.id}>
      {entry.parts.map((part, part_index) => {
        const key = `${entry.id}-${part_index.toString()}`;
        const is_last = part_index === entry.parts.length - 1;
        if (part.kind === "thinking") {
          return (
            <AgentDetailEntry
              key={key}
              kind="thinking"
              label={t("agent_page.thinking")}
              status={!entry.complete && is_last ? "running" : "success"}
              content={part.text}
            />
          );
        }
        return (
          <div className="agent-message__markdown" key={key}>
            <AgentMarkdown text={part.text} complete={entry.complete} />
            {!entry.complete && state === "running" && is_last && (
              <span className="agent-message__cursor" />
            )}
          </div>
        );
      })}
    </article>
  );
}

/** 每轮只在未结束时持有一个本地时钟；结束时间始终以后端 user 条目为准。 */
function AgentRoundHeader({ user, t }: { user: UserEntry; t: Translate }): JSX.Element {
  const [now, set_now] = useState(Date.now);

  useEffect(() => {
    if (user.endedAt !== null) return;
    const timer = window.setInterval(() => set_now(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [user.endedAt]);

  const duration = format_elapsed((user.endedAt ?? now) - user.createdAt);
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

/** 工具输出与思考过程共享折叠交互，但保留各自的语义 class。 */
function AgentDetailEntry(props: AgentDetailEntryProps): JSX.Element {
  return (
    <details className={`agent-detail-entry agent-detail-entry--${props.kind}`}>
      <summary>
        <span className="agent-detail-entry__label">{props.label}</span>
        <span
          className={`agent-detail-entry__status agent-detail-entry__status--${props.status}`}
          aria-hidden="true"
        />
      </summary>
      {props.content !== null && <pre tabIndex={0}>{props.content}</pre>}
    </details>
  );
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
