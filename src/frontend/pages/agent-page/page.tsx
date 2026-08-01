import { useEffect, useRef, useState, type UIEvent } from "react";
import { BookCheck, Bot, Sparkles } from "lucide-react";

import type { AgentUserMessagePart } from "@shared/agent";
import { useI18n } from "@frontend/app/locale/locale-provider";
import { useModelSelection } from "@frontend/features/model-selection/use-model-selection";
import { useRuntimeSnapshot } from "@frontend/app/state/use-desktop-state";
import { is_runtime_busy } from "@frontend/app/state/runtime-activity-store";
import type { ScreenComponentProps } from "@frontend/app/navigation/types";
import { Card } from "@frontend/shadcn/card";
import { AppAlertDialog } from "@frontend/widgets/app-alert-dialog";
import { AgentComposer, type AgentComposerHandle } from "./agent-composer";
import { AgentTimeline } from "./agent-timeline";
import { useAgentPageState } from "./use-agent-page-state";
import "./agent-page.css";

const GLOSSARY_AUDIT_SKILL_NAME = "glossary-audit";
const AGENT_CONVERSATION_SCROLL_KEYS = new Set(["ArrowUp", "Home", "PageUp"]);

/** 渲染 Agent 对话、能力选择与命令输入；会话事实由 useAgentPageState 统一提供。 */
export function AgentPage(_props: ScreenComponentProps): JSX.Element {
  const { t } = useI18n();
  const agent = useAgentPageState();
  const model_selection = useModelSelection();
  const runtime_snapshot = useRuntimeSnapshot();
  const conversation_ref = useRef<HTMLElement | null>(null);
  const composer_ref = useRef<AgentComposerHandle | null>(null);
  const auto_follow_ref = useRef(true); // 用户主动接管滚动后，流式增量不得抢回位置
  const programmatic_scroll_ref = useRef(false); // 平滑滚动中间帧不是用户离开底部
  const [reset_dialog_open, set_reset_dialog_open] = useState(false);
  const is_running = agent.state === "running";

  useEffect(() => {
    const conversation = conversation_ref.current;
    if (conversation === null || !auto_follow_ref.current) return;
    programmatic_scroll_ref.current = true;
    conversation.scrollTo({ top: conversation.scrollHeight });
  }, [agent.entries, agent.state]);

  const stop_auto_follow = (): void => {
    programmatic_scroll_ref.current = false;
    auto_follow_ref.current = false;
  };

  const update_auto_follow = (target: HTMLElement): void => {
    auto_follow_ref.current = is_near_conversation_end(target);
  };

  const send = (parts: readonly AgentUserMessagePart[]): Promise<boolean> => {
    auto_follow_ref.current = true;
    return agent.send(parts);
  };

  return (
    <div className="agent-page page-shell page-shell--full">
      <section
        ref={conversation_ref}
        className="agent-page__conversation"
        aria-label={t("agent_page.title")}
        aria-live="polite"
        onWheel={stop_auto_follow}
        onPointerDown={stop_auto_follow}
        onKeyDown={(event) => {
          if (AGENT_CONVERSATION_SCROLL_KEYS.has(event.key)) stop_auto_follow();
        }}
        onScroll={(event: UIEvent<HTMLElement>) => {
          if (!programmatic_scroll_ref.current) update_auto_follow(event.currentTarget);
        }}
        onScrollEnd={(event: UIEvent<HTMLElement>) => {
          programmatic_scroll_ref.current = false;
          update_auto_follow(event.currentTarget);
        }}
      >
        {agent.loading ? (
          <div className="agent-page__empty" role="status">
            <div className="agent-page__empty-intro">
              <Bot className="agent-page__empty-icon" aria-hidden="true" />
              <p>{t("agent_page.loading")}</p>
            </div>
          </div>
        ) : agent.entries.length === 0 ? (
          <div className="agent-page__empty">
            <div className="agent-page__empty-intro">
              <Bot className="agent-page__empty-icon" aria-hidden="true" />
              <p className="agent-page__empty-message">{t("agent_page.empty.message")}</p>
            </div>
            <div className="agent-page__suggestions">
              <Card
                asChild
                className="agent-page__suggestion"
                onClick={() =>
                  composer_ref.current?.write_draft([
                    { kind: "text", text: t("agent_page.empty.suggestions.capabilities") },
                  ])
                }
              >
                <button type="button">
                  <Sparkles className="agent-page__suggestion-icon" aria-hidden="true" />
                  <span className="agent-page__suggestion-label">
                    {t("agent_page.empty.suggestions.capabilities")}
                  </span>
                </button>
              </Card>
              {agent.skills.some((skill) => skill.name === GLOSSARY_AUDIT_SKILL_NAME) && (
                <Card
                  asChild
                  className="agent-page__suggestion"
                  onClick={() =>
                    composer_ref.current?.write_draft([
                      {
                        kind: "text",
                        text: `${t("agent_page.empty.suggestions.glossary_audit")} `,
                      },
                      { kind: "skill", name: GLOSSARY_AUDIT_SKILL_NAME },
                    ])
                  }
                >
                  <button type="button">
                    <BookCheck className="agent-page__suggestion-icon" aria-hidden="true" />
                    <span className="agent-page__suggestion-label">
                      {t("agent_page.empty.suggestions.glossary_audit")}{" "}
                      <span className="agent-skill-token">@{GLOSSARY_AUDIT_SKILL_NAME}</span>
                    </span>
                  </button>
                </Card>
              )}
            </div>
          </div>
        ) : (
          <AgentTimeline entries={agent.entries} state={agent.state} />
        )}
      </section>

      <AgentComposer
        ref={composer_ref}
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

function is_near_conversation_end(target: HTMLElement): boolean {
  return target.scrollHeight - target.scrollTop - target.clientHeight < 80;
}
