import { useCallback, useLayoutEffect, useMemo, useRef, useState, type UIEvent } from "react";
import { ArrowDown, BookCheck, Bot, ScanText, Sparkles, WifiOff } from "lucide-react";

import { QualityRule, type GlossaryEntry } from "@domain/quality";
import { format_agent_skill_reference, type AgentEntryStatus } from "@shared/agent";
import { normalize_quality_rule_entries } from "@shared/quality/quality-rule-entry";
import { useDesktopToast } from "@frontend/app/feedback/desktop-toast";
import { resolve_visible_error_message } from "@frontend/app/feedback/visible-error-message";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-provider";
import { useQualityRuleStatistics } from "@frontend/app/session/quality-rule-statistics-context";
import { useModelSelection } from "@frontend/features/model-selection/use-model-selection";
import { useDesktopState, useRuntimeSnapshot } from "@frontend/app/state/use-desktop-state";
import { useQualityRuleQuery } from "@frontend/features/quality-rule-editor/use-quality-rule-query";
import type { QualityRuleQuerySlice } from "@frontend/features/quality-rule-editor/quality-rule-api-client";
import type { ScreenComponentProps } from "@frontend/app/navigation/types";
import { Card } from "@frontend/shadcn/card";
import { AppAlertDialog } from "@frontend/widgets/app-alert-dialog";
import { AppButton } from "@frontend/widgets/app-button";
import { useAgentSession } from "@frontend/app/session/agent/agent-session-context";
import { AgentComposer, type AgentComposerHandle } from "./agent-composer";
import { create_agent_mention_tokens } from "./agent-mention";
import { AgentTimeline } from "./agent-timeline";
import { is_at_scroll_end } from "./agent-scroll";
import "./agent-page.css";

/** 空会话只展示产品内置且确已加载的高频工作流，顺序同时决定界面优先级。 */
const FEATURED_AGENT_SKILLS = [
  {
    name: "glossary-review",
    suggestionKey: "agent_page.empty.suggestions.glossary_review",
    Icon: BookCheck,
  },
  {
    name: "translation-review",
    suggestionKey: "agent_page.empty.suggestions.translation_review",
    Icon: ScanText,
  },
] as const;
/** 外层会话滚动与详情滚动共用暂停集合，此固定键代表外层容器。 */
const AGENT_CONVERSATION_FOLLOW_HOLD = "conversation";
/** 未加载工程时复用稳定空数组，避免无事实变化却重建 mention 投影。 */
const EMPTY_AGENT_TERMS: GlossaryEntry[] = [];
/** live region 只播报离散轮次状态，不复述高频流式正文。 */
const AGENT_STATUS_LABEL_KEYS = Object.freeze({
  running: "agent_page.status.running",
  success: "agent_page.status.success",
  error: "agent_page.status.error",
  stopped: "agent_page.status.stopped",
} satisfies Readonly<Record<AgentEntryStatus, LocaleKey>>);

/** 术语菜单复用共享规则归一化，不复制规则页编辑状态。 */
function normalize_agent_terms(
  slice: QualityRuleQuerySlice<"glossary"> | undefined,
): GlossaryEntry[] {
  return normalize_quality_rule_entries(
    QualityRule.from_json("glossary"),
    slice?.entries ?? [],
  ) as GlossaryEntry[];
}

/** 渲染 Agent 对话、能力选择与命令输入；会话事实由跨路由 Agent session 提供。 */
export function AgentPage(_props: ScreenComponentProps): JSX.Element {
  const { t } = useI18n();
  const { push_toast } = useDesktopToast();
  const { project_snapshot, project_session_status = "ready" } = useDesktopState();
  const agent = useAgentSession();
  const model_selection = useModelSelection();
  const runtime_snapshot = useRuntimeSnapshot();
  const conversation_ref = useRef<HTMLElement | null>(null);
  const composer_ref = useRef<AgentComposerHandle | null>(null);
  const [follow_holds, set_follow_holds] = useState<ReadonlySet<string>>(() => new Set());
  const [resume_revision, set_resume_revision] = useState(0); // 统一通知所有展开详情回到各自底端
  const [reset_dialog_open, set_reset_dialog_open] = useState(false);
  const handle_terms_load_error = useCallback((): void => {
    push_toast("error", t("agent_page.error.terms_load"));
  }, [push_toast, t]);
  const { quality_slice: terms } = useQualityRuleQuery({
    rule_type: "glossary",
    project_path: project_snapshot.loaded ? project_snapshot.path : "",
    session_ready: project_session_status === "ready",
    default_slice: EMPTY_AGENT_TERMS,
    normalize_slice: normalize_agent_terms,
    on_load_error: handle_terms_load_error,
  });
  const term_statistics = useQualityRuleStatistics("glossary");
  // 只展示已完成统计的命中数，避免把尚未计算的术语误报为零命中。
  const term_hit_counts = useMemo<Readonly<Record<string, number>>>(() => {
    return Object.fromEntries(
      term_statistics.completed_entry_ids.map((entry_id) => [
        entry_id,
        term_statistics.matched_count_by_entry_id[entry_id] ?? 0,
      ]),
    );
  }, [term_statistics.completed_entry_ids, term_statistics.matched_count_by_entry_id]);
  const available_terms =
    project_snapshot.loaded && project_session_status === "ready" ? terms : EMPTY_AGENT_TERMS;
  const mention_tokens = useMemo(
    () => create_agent_mention_tokens(agent.skills, available_terms),
    [agent.skills, available_terms],
  );
  const is_running = agent.state === "running";
  const agent_restoring = agent.transport === "restoring";
  const user_entries = agent.entries.filter((entry) => entry.kind === "user_message");
  const last_user = user_entries.at(-1);
  const follow_paused = follow_holds.size > 0;
  // 公开回合先回 idle、共享 lease 后释放；两者之间统一显示为 Agent 自身结算。
  const agent_settling = !is_running && runtime_snapshot.owner === "agent";
  const unavailable_reason =
    agent_restoring || agent.transport === "restore_failed"
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

  /** 命令失败只投影为页面 Toast，不写回共享会话状态。 */
  const show_command_error = useCallback(
    (error: unknown, fallback_key: LocaleKey): void => {
      push_toast("error", resolve_visible_error_message(error, t, t(fallback_key)));
    },
    [push_toast, t],
  );

  /** 新消息代表用户重新进入最新上下文，提交前统一恢复信息流跟随。 */
  const send = (text: string): void => {
    resume_follow();
    void agent.send(text).catch((error: unknown) => {
      show_command_error(error, "agent_page.error.send");
    });
  };

  /** stop 失败保留运行态，由页面 Toast 提示后允许继续尝试。 */
  const stop = async (): Promise<void> => {
    try {
      await agent.stop();
    } catch (error) {
      show_command_error(error, "agent_page.error.stop");
    }
  };

  // live region 只播报离散会话结果，不朗读高频流式正文。
  const live_status = agent_restoring
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
        {agent.transport === "disconnected" && (
          <div className="agent-page__connection-status" role="status">
            <WifiOff aria-hidden="true" />
            <span>{t("agent_page.error.connection")}</span>
          </div>
        )}
        {agent.transport === "restore_failed" ? (
          <div className="agent-page__empty" role="alert">
            <div className="agent-page__empty-intro">
              <Bot className="agent-page__empty-icon" aria-hidden="true" />
              <p>{t("agent_page.error.restore")}</p>
              <AppButton type="button" size="sm" variant="outline" onClick={agent.reconnect}>
                {t("agent_page.action.retry")}
              </AppButton>
            </div>
          </div>
        ) : agent_restoring ? (
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
                  composer_ref.current?.write_draft(t("agent_page.empty.suggestions.capabilities"))
                }
              >
                <button type="button">
                  <Sparkles className="agent-page__suggestion-icon" aria-hidden="true" />
                  <span className="agent-page__suggestion-label">
                    {t("agent_page.empty.suggestions.capabilities")}
                  </span>
                </button>
              </Card>
              {FEATURED_AGENT_SKILLS.filter((featured) =>
                agent.skills.some((skill) => skill.name === featured.name),
              ).map(({ name, suggestionKey, Icon }) => (
                <Card
                  key={name}
                  asChild
                  className="agent-page__suggestion"
                  onClick={() =>
                    composer_ref.current?.write_draft(
                      `${t(suggestionKey)} ${format_agent_skill_reference(name)}`,
                    )
                  }
                >
                  <button type="button">
                    <Icon className="agent-page__suggestion-icon" aria-hidden="true" />
                    <span className="agent-page__suggestion-label">
                      {t(suggestionKey)}{" "}
                      <span className="agent-mention-token">
                        <span>{format_agent_skill_reference(name)}</span>
                      </span>
                    </span>
                  </button>
                </Card>
              ))}
            </div>
          </div>
        ) : (
          <AgentTimeline
            entries={agent.entries}
            mention_tokens={mention_tokens}
            resume_revision={resume_revision}
            on_follow_hold_change={set_follow_hold}
            on_retry={(text) => composer_ref.current?.write_draft(text)}
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
        terms={available_terms}
        term_hit_counts={term_hit_counts}
        running={is_running}
        unavailable_reason={unavailable_reason}
        command={agent.command}
        can_reset={!agent_restoring && agent.entries.length > 0}
        context_tokens={agent.contextTokens}
        model_selection={model_selection}
        input_session={agent.input}
        on_send={send}
        on_stop={stop}
        on_reset={() => set_reset_dialog_open(true)}
      />
      <AppAlertDialog
        open={reset_dialog_open}
        description={t("agent_page.confirm.new_task")}
        submitting={agent.command === "reset"}
        onConfirm={async () => {
          try {
            await agent.reset();
            set_reset_dialog_open(false);
          } catch (error) {
            show_command_error(error, "agent_page.error.reset");
          }
        }}
        onClose={() => set_reset_dialog_open(false)}
      />
    </div>
  );
}
