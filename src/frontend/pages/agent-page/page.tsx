import { useEffect, useRef, type ReactNode, type UIEvent } from "react";
import { Bot } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { AgentEntry, AgentSessionState, AgentUserMessagePart } from "@shared/agent";
import { open_external_url } from "@frontend/app/desktop/desktop-api";
import { useI18n } from "@frontend/app/locale/locale-provider";
import type { ScreenComponentProps } from "@frontend/app/navigation/types";
import { AgentComposer } from "./agent-composer";
import { useAgentPageState } from "./use-agent-page-state";
import "./agent-page.css";

type Translate = ReturnType<typeof useI18n>["t"];
type ToolEntry = Extract<AgentEntry, { kind: "tool_call" }>;

/** 渲染 Agent 对话、能力选择与命令输入；会话事实由 useAgentPageState 统一提供。 */
export function AgentPage(_props: ScreenComponentProps): JSX.Element {
  const { t } = useI18n();
  const agent = useAgentPageState();
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
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry === undefined) continue;
    if (entry.kind === "tool_call") {
      nodes.push(render_tool_entry(entry));
      continue;
    }
    if (entry.kind === "user_message") {
      nodes.push(render_round_header(entries, index, state, t));
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
    if (entry.text === "" && entry.complete) continue;
    nodes.push(
      <article className="agent-message agent-message--assistant" key={entry.id}>
        <div className="agent-message__markdown">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children }) => (
                <a
                  href={href}
                  onClick={(event) => {
                    event.preventDefault();
                    if (href !== undefined) void open_external_url(href);
                  }}
                >
                  {children}
                </a>
              ),
            }}
          >
            {entry.text}
          </ReactMarkdown>
          {!entry.complete && state === "running" && <span className="agent-message__cursor" />}
        </div>
      </article>,
    );
  }
  return nodes;
}

/** 每个 user 条目开启一轮；完成态用该轮最后条目的时间计算可见耗时。 */
function render_round_header(
  entries: AgentEntry[],
  user_index: number,
  state: AgentSessionState,
  t: Translate,
): ReactNode {
  const user = entries[user_index];
  if (user?.kind !== "user_message") return null;
  const next_user_offset = entries
    .slice(user_index + 1)
    .findIndex((entry) => entry.kind === "user_message");
  const next_user_index = next_user_offset < 0 ? -1 : user_index + next_user_offset + 1;
  const end =
    next_user_index >= 0
      ? entries[next_user_index - 1]
      : state === "complete"
        ? entries.at(-1)
        : undefined;
  const duration = end === undefined ? "…" : format_elapsed(end.createdAt - user.createdAt);
  return (
    <div className="agent-round-header" key={`round-${user.id}`}>
      <span aria-hidden="true" />
      <small>{t("agent_page.round.elapsed", { duration })}</small>
    </div>
  );
}

function render_tool_entry(tool: ToolEntry): ReactNode {
  return (
    <details className="agent-tool-entry" key={tool.id}>
      <summary>
        <span className="agent-tool-entry__name">{tool.toolName}</span>
        <span
          className={`agent-tool-entry__status agent-tool-entry__status--${tool.status}`}
          aria-hidden="true"
        />
      </summary>
      {tool.output !== null && <pre tabIndex={0}>{format_tool_output(tool.output)}</pre>}
    </details>
  );
}

function format_tool_output(output: string): string {
  try {
    return JSON.stringify(JSON.parse(output) as unknown, null, 2) ?? output;
  } catch {
    return output;
  }
}

function format_elapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes === 0
    ? `${seconds.toString()}s`
    : `${minutes.toString()}m ${(seconds % 60).toString()}s`;
}
