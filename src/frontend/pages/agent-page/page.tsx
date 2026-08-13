import { useCallback, useLayoutEffect, useMemo, useRef, useState, type UIEvent } from "react";
import { ArrowDown, BookPlus, Bot, ScanText, Sparkles, WifiOff } from "lucide-react";

import { QualityRule, type GlossaryEntry } from "@domain/quality";
import {
  format_agent_skill_reference,
  type AgentEntry,
  type AgentMessageInput,
} from "@shared/agent";
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
    name: "glossary-create",
    suggestionKey: "agent_page.empty.suggestions.glossary_create",
    Icon: BookPlus,
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
/** 只有会重跑模型且可能重复工程副作用的操作进入确认队列。 */
type PendingRoundExecution =
  | { kind: "retry"; entryId: string }
  | { kind: "edit_input"; entryId: string; message: AgentMessageInput };

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
  const [pending_round_execution, set_pending_round_execution] =
    useState<PendingRoundExecution | null>(null);
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
      (term_statistics.entry_ids ?? []).map((entry_id) => [
        entry_id,
        term_statistics.hits_by_entry_id[entry_id] ?? 0,
      ]),
    );
  }, [term_statistics.entry_ids, term_statistics.hits_by_entry_id]);
  const available_terms =
    project_snapshot.loaded && project_session_status === "ready" ? terms : EMPTY_AGENT_TERMS;
  const mention_tokens = useMemo(
    () => create_agent_mention_tokens(agent.skills, available_terms),
    [agent.skills, available_terms],
  );
  const is_running = agent.state === "running";
  // apply 一旦进入公开 running 工具帧就不可取消；后端仍保留同一权威守卫。
  const workspace_apply_running = agent.entries.some(
    (entry) =>
      entry.kind === "tool_call" &&
      entry.toolName === "workspace_apply" &&
      entry.status === "running",
  );
  const agent_restoring = agent.transport === "restoring";
  const last_compaction = agent.entries.findLast((entry) => entry.kind === "context_compaction");
  const compacting = last_compaction?.status === "running";
  const compaction_failed = last_compaction?.status === "error";
  // 副作用确认只检查最新轮次；更早轮次不会被当前重试或输入修改重新执行。
  const latest_user_index = agent.entries.findLastIndex((entry) => entry.kind === "user_message");
  const latest_round_applied_workspace = agent.entries.some(
    (entry, index) =>
      index > latest_user_index &&
      entry.kind === "tool_call" &&
      entry.toolName === "workspace_apply" &&
      entry.status === "success",
  );
  const follow_paused = follow_holds.size > 0;
  // 公开回合先回 idle、共享 lease 后释放；两者之间统一显示为 Agent 自身结算。
  const agent_settling = !is_running && !compacting && runtime_snapshot.owner === "agent";
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

  /** 真正执行会重跑模型的轮次操作；确认弹窗只决定何时进入这个唯一入口。 */
  const execute_round_revision = async (execution: PendingRoundExecution): Promise<void> => {
    resume_follow();
    try {
      if (execution.kind === "retry") await agent.retryLatestRound(execution.entryId);
      else await agent.editLatestRoundMessage(execution.entryId, execution.message);
    } catch (error) {
      show_command_error(
        error,
        execution.kind === "retry" ? "agent_page.error.retry" : "agent_page.error.edit",
      );
    } finally {
      set_pending_round_execution(null);
    }
  };

  /** 普通发送与当前编辑共用唯一 Composer；失败时共享输入会话保留编辑缓冲。 */
  const send = (message: AgentMessageInput): void => {
    const editing = agent.input.editing;
    if (editing === null) {
      resume_follow();
      void agent.send(message).catch((error: unknown) => {
        show_command_error(error, "agent_page.error.send");
      });
      return;
    }
    if (editing.role === "user" && latest_round_applied_workspace) {
      set_pending_round_execution({
        kind: "edit_input",
        entryId: editing.entryId,
        message: structuredClone(message),
      });
      return;
    }
    if (editing.role === "user") {
      void execute_round_revision({ kind: "edit_input", entryId: editing.entryId, message });
      return;
    }
    resume_follow();
    void agent.editLatestRoundMessage(editing.entryId, message).catch((error: unknown) => {
      show_command_error(error, "agent_page.error.edit");
    });
  };

  /** 主动重试由后端删除旧尝试并复用原 user 输入，不改写草稿与输入历史。 */
  const retry_latest_round = (entry_id: string): void => {
    const execution: PendingRoundExecution = { kind: "retry", entryId: entry_id };
    if (latest_round_applied_workspace) {
      set_pending_round_execution(execution);
      return;
    }
    void execute_round_revision(execution);
  };

  /** 修改入口只切换共享输入会话，再把焦点交还唯一 Composer。 */
  const start_edit = (
    entry: Extract<AgentEntry, { kind: "user_message" | "assistant_message" }>,
  ): void => {
    agent.input.start_edit(entry);
    composer_ref.current?.focus();
  };

  /** stop 失败保留运行态，由页面 Toast 提示后允许继续尝试。 */
  const stop = async (): Promise<void> => {
    try {
      await agent.stop();
    } catch (error) {
      show_command_error(error, "agent_page.error.stop");
    }
  };

  /** 压缩失败由时间线原位恢复；命令受理失败才使用一次性 Toast。 */
  const retry_compaction = (): void => {
    resume_follow();
    void agent.retryCompaction().catch((error: unknown) => {
      show_command_error(error, "agent_page.error.compaction_retry");
    });
  };

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
                {t("app.action.retry")}
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
            on_retry={retry_latest_round}
            on_edit={start_edit}
            on_compaction_retry={retry_compaction}
            revision_disabled={
              agent.command !== null ||
              agent.input.editing !== null ||
              is_running ||
              compacting ||
              compaction_failed ||
              unavailable_reason !== null
            }
            compaction_retry_disabled={
              agent.command !== null || is_running || compacting || unavailable_reason !== null
            }
          />
        )}
        <div
          className="agent-page__scroll-anchor"
          data-enabled={!follow_paused}
          aria-hidden="true"
        />
      </section>

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
        stop_disabled={workspace_apply_running}
        compacting={compacting}
        compaction_failed={compaction_failed}
        unavailable_reason={unavailable_reason}
        command={agent.command}
        can_reset={!agent_restoring && agent.entries.length > 0}
        context_tokens={agent.contextTokens}
        model_selection={model_selection}
        input_session={agent.input}
        on_send={send}
        on_image_error={() => push_toast("error", t("agent_page.error.image"))}
        on_stop={stop}
        on_reset={() => set_reset_dialog_open(true)}
      />
      <AppAlertDialog
        open={pending_round_execution !== null}
        description={t("agent_page.confirm.rerun_after_workspace_apply")}
        submitting={agent.command === "retry" || agent.command === "edit"}
        onConfirm={async () => {
          if (pending_round_execution !== null) {
            await execute_round_revision(pending_round_execution);
          }
        }}
        onClose={() => set_pending_round_execution(null)}
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
