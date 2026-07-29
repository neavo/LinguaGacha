import { useEffect, useRef, type KeyboardEvent, type UIEvent } from "react";
import { Bot, Check, CircleAlert, RotateCcw, Send, Square, UserRound, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { ScreenComponentProps } from "@frontend/app/navigation/types";
import { useI18n } from "@frontend/app/locale/locale-provider";
import { open_external_url } from "@frontend/app/desktop/desktop-api";
import { AppButton } from "@frontend/widgets/app-button";
import { Textarea } from "@frontend/shadcn/textarea";
import { cn } from "@frontend/shadcn/classnames";
import { useAgentPageState } from "./use-agent-page-state";
import "./agent-page.css";

/**
 * 渲染 Agent 对话、能力选择与命令输入；会话事实由 useAgentPageState 统一提供。
 */
export function AgentPage(_props: ScreenComponentProps): JSX.Element {
  const { t } = useI18n();
  const agent = useAgentPageState();
  const message_end_ref = useRef<HTMLDivElement | null>(null);
  const auto_follow_ref = useRef(true); // 用户主动离开底部后，流式增量不得抢回滚动位置
  const is_running = agent.state === "running";
  const can_send = !is_running && (agent.input.trim() !== "" || agent.selected_skill !== null);
  const active_skill = agent.skills.find((skill) => skill.name === agent.selected_skill) ?? null;

  useEffect(() => {
    if (auto_follow_ref.current) message_end_ref.current?.scrollIntoView({ block: "end" });
  }, [agent.messages, agent.tool_statuses]);

  /**
   * 每次主动发送重新启用自动跟随，保证新回合从最新消息开始观察。
   */
  const send = async (): Promise<void> => {
    auto_follow_ref.current = true;
    await agent.send(t("agent_page.skill.prompt"));
  };

  /**
   * 输入框统一处理能力选择和 Enter 发送，同时保留 IME 与 Shift+Enter 语义。
   */
  const handle_key_down = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (agent.skill_menu_open) {
      if (event.key === "Escape") {
        event.preventDefault();
        agent.update_input(agent.input.replace(/(^|\s)@[^\s@]*$/u, "$1"));
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        return;
      }
      if (event.key === "Enter" && !event.nativeEvent.isComposing) {
        event.preventDefault();
        const first_skill = agent.skills[0];
        if (first_skill !== undefined) agent.select_skill(first_skill.name);
        return;
      }
    }
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (can_send) void send();
  };

  return (
    <div className="agent-page page-shell page-shell--full">
      <section
        className="agent-page__conversation"
        aria-label={t("agent_page.conversation_label")}
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
        ) : agent.messages.length === 0 ? (
          <div className="agent-page__empty">
            <Bot aria-hidden="true" />
            <h2>{t("agent_page.empty.title")}</h2>
            <p>{t("agent_page.empty.description")}</p>
          </div>
        ) : (
          <div className="agent-page__messages">
            {agent.messages.map((message) => (
              <article
                className={cn("agent-message", `agent-message--${message.role}`)}
                key={message.id}
              >
                <div className="agent-message__avatar" aria-hidden="true">
                  {message.role === "assistant" ? <Bot /> : <UserRound />}
                </div>
                <div className="agent-message__body">
                  <div className="agent-message__role">
                    {message.role === "assistant"
                      ? t("agent_page.role.agent")
                      : t("agent_page.role.user")}
                  </div>
                  {message.role === "assistant" ? (
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
                        {message.text}
                      </ReactMarkdown>
                      {!message.complete && is_running && (
                        <span className="agent-message__cursor" />
                      )}
                    </div>
                  ) : (
                    <p className="agent-message__user-text">{message.text}</p>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}

        {agent.tool_statuses.length > 0 && (
          <div className="agent-page__tool-log" aria-label={t("agent_page.tool.label")}>
            {agent.tool_statuses.slice(-3).map((tool) => (
              <div className="agent-tool-status" key={tool.toolCallId}>
                {tool.status === "success" ? (
                  <Check aria-hidden="true" />
                ) : tool.status === "error" ? (
                  <CircleAlert aria-hidden="true" />
                ) : (
                  <span className="agent-tool-status__pulse" aria-hidden="true" />
                )}
                <span>{tool.toolName}</span>
                <span className="agent-tool-status__state">
                  {t(`agent_page.tool.${tool.status}`)}
                </span>
              </div>
            ))}
          </div>
        )}
        <div ref={message_end_ref} />
      </section>

      <form
        className="agent-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        {agent.skill_menu_open && (
          <div
            id="agent-skill-menu"
            className="agent-skill-menu"
            role="listbox"
            aria-label={t("agent_page.skill.label")}
          >
            {agent.skills.map((skill, index) => (
              <button
                id={`agent-skill-${skill.name}`}
                key={skill.name}
                type="button"
                role="option"
                aria-selected={index === 0}
                tabIndex={-1}
                onClick={() => agent.select_skill(skill.name)}
              >
                <Bot aria-hidden="true" />
                <span>
                  <strong>{skill.name}</strong>
                  <small>{skill.description}</small>
                </span>
              </button>
            ))}
          </div>
        )}

        {agent.selected_skill !== null && (
          <div className="agent-composer__skill">
            <Bot aria-hidden="true" />
            <span>{active_skill?.name ?? agent.selected_skill}</span>
            <button
              type="button"
              onClick={agent.clear_skill}
              aria-label={t("agent_page.skill.clear")}
            >
              <X aria-hidden="true" />
            </button>
          </div>
        )}

        <div className="agent-composer__input-row">
          <Textarea
            value={agent.input}
            onChange={(event) => agent.update_input(event.target.value)}
            onKeyDown={handle_key_down}
            placeholder={t("agent_page.input.placeholder")}
            aria-label={t("agent_page.input.label")}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={agent.skill_menu_open}
            aria-controls="agent-skill-menu"
            aria-activedescendant={
              agent.skill_menu_open && agent.skills[0] !== undefined
                ? `agent-skill-${agent.skills[0].name}`
                : undefined
            }
            disabled={is_running}
          />
          <div className="agent-composer__actions">
            <AppButton
              type="button"
              variant="outline"
              onClick={() => void agent.reset()}
              disabled={is_running || agent.messages.length === 0}
              aria-label={t("agent_page.action.reset")}
              title={t("agent_page.action.reset")}
            >
              <RotateCcw aria-hidden="true" />
            </AppButton>
            <AppButton
              type="button"
              variant="outline"
              onClick={() => void agent.stop()}
              disabled={!is_running}
            >
              <Square aria-hidden="true" />
              {t("agent_page.action.stop")}
            </AppButton>
            <AppButton type="submit" disabled={!can_send}>
              <Send aria-hidden="true" />
              {t("agent_page.action.send")}
            </AppButton>
          </div>
        </div>
        <div className="agent-composer__meta">
          <span>{t(`agent_page.state.${agent.state}`)}</span>
          {agent.error && <span className="agent-composer__error">{t("agent_page.error")}</span>}
          <span>{t("agent_page.input.hint")}</span>
        </div>
      </form>
    </div>
  );
}
