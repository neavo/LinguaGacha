import { useCallback, useLayoutEffect, useRef, useState, type UIEvent } from "react";
import { ArrowDown, BookCheck, Bot, Sparkles } from "lucide-react";

import type { AgentEntryStatus, AgentUserMessagePart } from "@shared/agent";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-provider";
import { useModelSelection } from "@frontend/features/model-selection/use-model-selection";
import { useRuntimeSnapshot } from "@frontend/app/state/use-desktop-state";
import type { ScreenComponentProps } from "@frontend/app/navigation/types";
import { Card } from "@frontend/shadcn/card";
import { AppAlertDialog } from "@frontend/widgets/app-alert-dialog";
import { AppButton } from "@frontend/widgets/app-button";
import { AgentComposer, type AgentComposerHandle } from "./agent-composer";
import { AgentTimeline } from "./agent-timeline";
import { is_at_scroll_end } from "./agent-scroll";
import { useAgentPageState } from "./use-agent-page-state";
import "./agent-page.css";

const GLOSSARY_AUDIT_SKILL_NAME = "glossary-audit";
const AGENT_CONVERSATION_FOLLOW_HOLD = "conversation";
const AGENT_STATUS_LABEL_KEYS = Object.freeze({
  running: "agent_page.status.running",
  success: "agent_page.status.success",
  error: "agent_page.status.error",
  stopped: "agent_page.status.stopped",
} satisfies Readonly<Record<AgentEntryStatus, LocaleKey>>);

/** 渲染 Agent 对话、能力选择与命令输入；会话事实由 useAgentPageState 统一提供。 */
export function AgentPage(_props: ScreenComponentProps): JSX.Element {
  const { t } = useI18n();
  const agent = useAgentPageState();
  const model_selection = useModelSelection();
  const runtime_snapshot = useRuntimeSnapshot();
  const conversation_ref = useRef<HTMLElement | null>(null);
  const composer_ref = useRef<AgentComposerHandle | null>(null);
  const [follow_holds, set_follow_holds] = useState<ReadonlySet<string>>(() => new Set());
  const [resume_revision, set_resume_revision] = useState(0); // 统一通知所有展开详情回到各自底端
  const [reset_dialog_open, set_reset_dialog_open] = useState(false);
  const is_running = agent.state === "running";
  const last_user = agent.entries.findLast((entry) => entry.kind === "user_message");
  const follow_paused = follow_holds.size > 0;
  // 公开回合先回 idle、共享 lease 后释放；两者之间统一显示为 Agent 自身结算。
  const agent_settling = !is_running && runtime_snapshot.owner === "agent";
  const unavailable_reason =
    agent.loading || agent.issue === "restore"
      ? "restoring"
      : agent_settling
        ? "settling"
        : runtime_snapshot.owner === "task"
          ? "runtime_busy"
          : null;

  /** 每个滚动容器只维护自己的暂停原因；任一原因存在时外层都不得抢回底端。 */
  const set_follow_hold = useCallback((id: string, paused: boolean): void => {
    set_follow_holds((current) => {
      if (current.has(id) === paused) return current;
      const next = new Set(current);
      if (paused) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  /** 显式恢复会同时清除外层与所有详情暂停，并触发详情自身归底。 */
  const resume_follow = useCallback((): void => {
    set_follow_holds(new Set());
    set_resume_revision((current) => current + 1);
  }, []);

  // 新条目与详情高度变化只在没有阅读暂停时即时归底；CSS 锚点继续承接异步布局变化。
  useLayoutEffect(() => {
    const conversation = conversation_ref.current;
    if (conversation === null || follow_paused) return;
    conversation.scrollTop = conversation.scrollHeight;
  }, [agent.entries, agent.state, follow_paused, resume_revision]);

  /** 新消息代表用户重新进入最新上下文，提交前统一恢复信息流跟随。 */
  const send = (parts: readonly AgentUserMessagePart[]): Promise<boolean> => {
    resume_follow();
    return agent.send(parts);
  };

  // live region 只播报离散会话结果，不朗读高频流式正文。
  const live_status = agent.loading
    ? t("agent_page.loading")
    : is_running
      ? t("agent_page.status.running")
      : last_user === undefined
        ? ""
        : t(AGENT_STATUS_LABEL_KEYS[last_user.status]);

  return (
    <div className="agent-page page-shell page-shell--full">
      <section
        ref={conversation_ref}
        className="agent-page__conversation"
        aria-label={t("agent_page.title")}
        onScroll={(event: UIEvent<HTMLElement>) => {
          set_follow_hold(AGENT_CONVERSATION_FOLLOW_HOLD, !is_at_scroll_end(event.currentTarget));
        }}
      >
        {agent.issue === "restore" ? (
          <div className="agent-page__empty" role="alert">
            <div className="agent-page__empty-intro">
              <Bot className="agent-page__empty-icon" aria-hidden="true" />
              <p>{t("agent_page.error.restore")}</p>
              <AppButton type="button" size="sm" variant="outline" onClick={agent.retry}>
                {t("agent_page.action.retry")}
              </AppButton>
            </div>
          </div>
        ) : agent.loading ? (
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
          <AgentTimeline
            entries={agent.entries}
            resume_revision={resume_revision}
            on_follow_hold_change={set_follow_hold}
          />
        )}
        <div
          className="agent-page__scroll-anchor"
          data-enabled={!follow_paused}
          aria-hidden="true"
        />
      </section>

      <span className="sr-only" role="status" aria-live="polite">
        {live_status}
      </span>
      {follow_paused && (
        <div className="agent-page__follow-control">
          <AppButton type="button" size="xs" variant="secondary" onClick={resume_follow}>
            <ArrowDown aria-hidden="true" />
            {t("agent_page.action.return_latest")}
          </AppButton>
        </div>
      )}

      <AgentComposer
        ref={composer_ref}
        skills={agent.skills}
        running={is_running}
        unavailable_reason={unavailable_reason}
        command={agent.command}
        issue={agent.issue}
        can_reset={!agent.loading && agent.entries.length > 0}
        context_usage={agent.contextUsage}
        model_selection={model_selection}
        on_send={send}
        on_stop={agent.stop}
        on_reset={() => set_reset_dialog_open(true)}
      />
      <AppAlertDialog
        open={reset_dialog_open}
        description={t(
          agent.issue === "reset" ? "agent_page.error.reset" : "agent_page.confirm.new_task",
        )}
        submitting={agent.command === "reset"}
        onConfirm={async () => {
          if (await agent.reset()) set_reset_dialog_open(false);
        }}
        onClose={() => set_reset_dialog_open(false)}
      />
    </div>
  );
}
