import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, Bot, Drama, ListChecks, ScanText, Sparkles, WifiOff } from "lucide-react";

import type { ModelThinkingLevel } from "@domain/model";
import { QualityRule, type GlossaryEntry } from "@domain/quality";
import {
  format_agent_skill_reference,
  type AgentApprovalMode,
  type AgentEntry,
  type AgentMessageInput,
  type AgentQueuedInput,
} from "@shared/agent";
import { normalize_quality_rule_entries } from "@shared/quality/quality-rule-entry";
import { useDesktopToast } from "@frontend/app/feedback/desktop-toast";
import { resolve_visible_error_message } from "@frontend/app/feedback/visible-error-message";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-provider";
import { useQualityRuleStatistics } from "@frontend/app/session/quality-rule-statistics-context";
import {
  read_selected_model,
  useModelSelection,
} from "@frontend/features/model-selection/use-model-selection";
import { useDesktopState, useRuntimeSnapshot } from "@frontend/app/state/use-desktop-state";
import { useQualityRuleQuery } from "@frontend/features/quality-rule-editor/use-quality-rule-query";
import type { QualityRuleQuerySlice } from "@frontend/features/quality-rule-editor/quality-rule-api-client";
import type { ScreenComponentProps } from "@frontend/app/navigation/types";
import { AppConfirmDialog } from "@frontend/widgets/app-alert-dialog";
import { AppButton } from "@frontend/widgets/app-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import { useAgentSession } from "@frontend/app/session/agent/agent-session-context";
import { AgentApprovalPanel } from "./agent-approval-panel";
import { AgentComposer, type AgentComposerHandle } from "./agent-composer";
import { AgentInlineEditor, type AgentInlineEditTarget } from "./agent-inline-editor";
import { AgentInputQueue } from "./agent-input-queue";
import { create_agent_mention_tokens } from "./agent-mention";
import { AgentTaskProgress } from "./agent-task-progress";
import { AgentTimeline } from "./agent-timeline";
import { useAgentAutoScroll } from "./agent-scroll";
import "./agent-page.css";

/** 空会话只展示产品内置且确已加载的高频工作流，顺序同时决定界面优先级。 */
const FEATURED_AGENT_SKILLS = [
  {
    name: "roleplay",
    suggestionKey: "agent_page.empty.suggestions.roleplay",
    Icon: Drama,
  },
  {
    name: "quality-rule-workflow",
    suggestionKey: "agent_page.empty.suggestions.quality_rule_workflow",
    Icon: ListChecks,
  },
  {
    name: "translation-review",
    suggestionKey: "agent_page.empty.suggestions.translation_review",
    Icon: ScanText,
  },
] as const;
/** 未加载工程时复用稳定空数组，避免无事实变化却重建 mention 投影。 */
const EMPTY_AGENT_TERMS: GlossaryEntry[] = [];

/** 同一个系统确认框承接首条发送与已有对话关闭思考两个用户动作。 */
type PendingThinkingOffAction =
  | { kind: "send"; message: AgentMessageInput }
  | { kind: "disable_thinking" };

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
  const conversation_content_ref = useRef<HTMLDivElement | null>(null);
  const composer_ref = useRef<AgentComposerHandle | null>(null);
  const [follow_latest, set_follow_latest] = useState(true); // 页面级实时阅读模式，滚动位置不参与推断
  const { follow_content: follow_conversation_content, resume: resume_conversation } =
    useAgentAutoScroll(follow_latest);
  const [reset_dialog_open, set_reset_dialog_open] = useState(false);
  const [pending_thinking_off_action, set_pending_thinking_off_action] =
    useState<PendingThinkingOffAction | null>(null);
  /** 页面只允许一个历史或队列目标进入原位编辑，普通 Composer 始终保持独立草稿。 */
  const [active_inline_edit, set_active_inline_edit] = useState<AgentInlineEditTarget | null>(null);
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
  // 暂停队列复用 Composer 的 continue 提交，不建立独立恢复控件。
  const can_continue_queue =
    !is_running && agent.inputQueue.paused && agent.inputQueue.items.length > 0;
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

  // 会话被 reset、换工程或其它入口替换后，原位编辑目标失去事实即自动退出。
  useEffect(() => {
    if (active_inline_edit === null) return;
    const target_exists =
      active_inline_edit.kind === "queue"
        ? agent.inputQueue.items.some((item) => item.id === active_inline_edit.itemId)
        : agent.entries.some((entry) => entry.id === active_inline_edit.entryId);
    if (!target_exists) set_active_inline_edit(null);
  }, [active_inline_edit, agent.entries, agent.inputQueue.items]);

  /** 显式激活最新并归底外层会话；活动思考视口消费同一页面状态。 */
  const activate_follow_latest = useCallback((): void => {
    set_follow_latest(true);
    const conversation = conversation_ref.current;
    if (conversation !== null) resume_conversation(conversation);
  }, [resume_conversation]);

  /** 新公开会话与重新激活“最新”时都在布局阶段归底。 */
  const conversation_key = agent.entries[0]?.id ?? null; // 首条公开条目身份定义页面滚动生命周期
  useLayoutEffect(() => {
    set_follow_latest(true);
  }, [conversation_key]);
  useLayoutEffect(() => {
    const conversation = conversation_ref.current;
    if (conversation !== null && follow_latest) resume_conversation(conversation);
  }, [conversation_key, follow_latest, resume_conversation]);

  // 外层只有一个显式滚动写入者；图片、详情与流式内容的尺寸变化共用同一观察入口。
  useLayoutEffect(() => {
    const conversation = conversation_ref.current;
    const content = conversation_content_ref.current;
    if (conversation === null || content === null) return;
    const observer = new ResizeObserver(() => follow_conversation_content(conversation));
    observer.observe(conversation);
    observer.observe(content);
    follow_conversation_content(conversation);
    return () => observer.disconnect();
  }, [follow_conversation_content]);

  /** 命令失败只投影为页面 Toast，不写回共享会话状态。 */
  const show_command_error = useCallback(
    (error: unknown, fallback_key: LocaleKey): void => {
      push_toast("error", resolve_visible_error_message(error, t, t(fallback_key)));
    },
    [push_toast, t],
  );

  const selected_agent_model = read_selected_model(model_selection, "agent");
  // 公开时间线出现条目才表示用户已经开始当前对话；隐藏会话种子不参与 UI 判断。
  const conversation_started = agent.entries.length > 0;
  /** 只警告支持思考且明确关闭思考的模型，不把能力缺失误报为用户选择。 */
  const thinking_off_confirmation_required =
    !can_continue_queue &&
    !conversation_started &&
    selected_agent_model?.thinking_level === "OFF" &&
    selected_agent_model.available_thinking_levels.includes("OFF");

  /** 页面内所有普通发送共用同一条实际提交出口，确认框只延迟调用它。 */
  const send_message = useCallback(
    async (message: AgentMessageInput): Promise<boolean> => {
      activate_follow_latest();
      const request = can_continue_queue
        ? agent.continue(
            message.text === "" && message.attachments.length === 0 ? undefined : message,
          )
        : agent.send(message);
      try {
        await request;
        return true;
      } catch (error: unknown) {
        show_command_error(
          error,
          can_continue_queue ? "agent_page.error.continue" : "agent_page.error.send",
        );
        return false;
      }
    },
    [activate_follow_latest, agent, can_continue_queue, show_command_error],
  );

  /** 普通发送继续使用底部 Composer；历史修订已由消息原位编辑器独立承接。 */
  const submit_message = (message: AgentMessageInput): void => {
    if (active_inline_edit !== null) return;
    if (thinking_off_confirmation_required) {
      set_pending_thinking_off_action({ kind: "send", message });
      return;
    }
    void send_message(message);
  };

  /** 空对话可自由配置；已有对话只有从其它档位切到关闭时才需确认。 */
  const change_agent_thinking_level = (thinking_level: ModelThinkingLevel): void => {
    if (
      conversation_started &&
      selected_agent_model !== null &&
      selected_agent_model.thinking_level !== "OFF" &&
      thinking_level === "OFF"
    ) {
      set_pending_thinking_off_action({ kind: "disable_thinking" });
      return;
    }
    void model_selection.update_thinking_level("agent", thinking_level);
  };

  /** 写入审批模式只接受后端确认的会话状态，失败沿用页面命令错误反馈。 */
  const change_approval_mode = useCallback(
    (approval_mode: AgentApprovalMode): void => {
      void agent.setApprovalMode(approval_mode).catch((error: unknown) => {
        show_command_error(error, "agent_page.error.approval_mode");
      });
    },
    [agent, show_command_error],
  );

  /** 审批面批准当前后端冻结的写入，错误沿用页面命令反馈。 */
  const approve_pending_write = useCallback(
    (switch_to_auto: boolean): void => {
      void agent.approvePendingWrite(switch_to_auto).catch((error: unknown) => {
        show_command_error(error, "agent_page.error.approval_decision");
      });
    },
    [agent, show_command_error],
  );

  /** 审批面拒绝当前后端冻结的写入，保持模型工具失败语义。 */
  const reject_pending_write = useCallback((): void => {
    void agent.rejectPendingWrite().catch((error: unknown) => {
      show_command_error(error, "agent_page.error.approval_decision");
    });
  }, [agent, show_command_error]);

  /** 发送失败保留确认框；模型更新沿用通用控制器自身的错误提示与恢复。 */
  const confirm_pending_thinking_off_action = async (): Promise<void> => {
    const action = pending_thinking_off_action;
    if (action === null) return;
    if (action.kind === "disable_thinking") {
      await model_selection.update_thinking_level("agent", "OFF");
      set_pending_thinking_off_action(null);
    } else if (await send_message(action.message)) {
      set_pending_thinking_off_action(null);
    }
  };

  /** 取消只撤销待确认动作，不发送消息也不更新模型。 */
  const close_pending_thinking_off_action = (): void => {
    set_pending_thinking_off_action(null);
  };

  /** 历史消息编辑只建立独立原位目标，不改写普通 Composer 草稿。 */
  const start_edit = (
    entry: Extract<AgentEntry, { kind: "user_message" | "assistant_message" }>,
  ): void => {
    set_active_inline_edit(
      entry.kind === "user_message"
        ? {
            kind: "entry",
            entryId: entry.id,
            role: "user",
            message: {
              text: entry.text,
              attachments: structuredClone(entry.attachments),
            },
          }
        : {
            kind: "entry",
            entryId: entry.id,
            role: "assistant",
            message: {
              text: entry.parts
                .filter((part) => part.kind === "text")
                .map((part) => part.text)
                .join(""),
              attachments: [],
            },
          },
    );
  };

  /** 原位修订统一走现有后端命令；成功后由编辑器关闭自身。 */
  const save_inline_edit = useCallback(
    async (message: AgentMessageInput): Promise<void> => {
      const target = active_inline_edit;
      if (target === null) return;
      if (target.kind === "queue") {
        await agent.updateQueuedMessage(target.itemId, message);
        agent.input.replace_history(target.message.text, message.text);
        return;
      }
      activate_follow_latest();
      await agent.reviseLatestRound(target.entryId, message);
      if (target.role === "user") {
        agent.input.replace_history(target.message.text, message.text);
      }
    },
    [activate_follow_latest, active_inline_edit, agent],
  );

  const cancel_inline_edit = useCallback((): void => {
    set_active_inline_edit(null);
  }, []);

  /** 后端受理成功后关闭原位编辑器；失败路径由编辑器自行保留草稿。 */
  const complete_inline_edit = useCallback(
    (_message: AgentMessageInput): void => cancel_inline_edit(),
    [cancel_inline_edit],
  );

  const handle_inline_image_error = useCallback((): void => {
    push_toast("error", t("agent_page.error.image"));
  }, [push_toast, t]);

  /** 时间线与队列只决定编辑目标，共享同一套编辑器装配。 */
  const render_inline_editor = useCallback(
    (target: AgentInlineEditTarget): JSX.Element => {
      return (
        <AgentInlineEditor
          target={target}
          skills={agent.skills}
          terms={available_terms}
          term_hit_counts={term_hit_counts}
          command={agent.command}
          model_selection={model_selection}
          unavailable_reason={unavailable_reason}
          on_save={save_inline_edit}
          on_saved={complete_inline_edit}
          on_cancel={cancel_inline_edit}
          on_image_error={handle_inline_image_error}
        />
      );
    },
    [
      agent.command,
      agent.skills,
      available_terms,
      cancel_inline_edit,
      complete_inline_edit,
      handle_inline_image_error,
      model_selection,
      save_inline_edit,
      term_hit_counts,
      unavailable_reason,
    ],
  );

  const render_entry_editor = useCallback(
    (entry: Extract<AgentEntry, { kind: "user_message" | "assistant_message" }>) => {
      if (
        active_inline_edit?.kind !== "entry" ||
        active_inline_edit.entryId !== entry.id ||
        active_inline_edit.role !== (entry.kind === "user_message" ? "user" : "assistant")
      ) {
        return null;
      }
      return render_inline_editor(active_inline_edit);
    },
    [active_inline_edit, render_inline_editor],
  );

  /** 队列目标复用同一原位编辑器。 */
  const start_queue_edit = (item: AgentQueuedInput): void => {
    set_active_inline_edit({
      kind: "queue",
      itemId: item.id,
      message: { text: item.text, attachments: structuredClone(item.attachments) },
    });
  };

  const render_queue_editor = useCallback(
    (item: AgentQueuedInput) => {
      if (active_inline_edit?.kind !== "queue" || active_inline_edit.itemId !== item.id) {
        return null;
      }
      return render_inline_editor(active_inline_edit);
    },
    [active_inline_edit, render_inline_editor],
  );

  /** 队列窄命令共享页面 Toast 映射，不污染会话状态。 */
  const run_queue_command = (command: () => Promise<void>, fallback_key: LocaleKey): void => {
    void command().catch((error: unknown) => show_command_error(error, fallback_key));
  };

  /** stop 失败保留运行态，由页面 Toast 提示后允许继续尝试。 */
  const stop = async (): Promise<void> => {
    try {
      await agent.stop();
    } catch (error) {
      show_command_error(error, "agent_page.error.stop");
    }
  };

  /** “继续”把所有尾部失败交给后端唯一恢复入口判断并续跑。 */
  const continue_latest_round = (): void => {
    activate_follow_latest();
    void agent.continue().catch((error: unknown) => {
      show_command_error(error, "agent_page.error.continue");
    });
  };

  return (
    <div className="agent-page">
      <section
        ref={conversation_ref}
        className="agent-page__conversation"
        aria-label={t("agent_page.title")}
        data-following={follow_latest || undefined}
      >
        <div ref={conversation_content_ref} className="agent-page__conversation-content">
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
                <button
                  type="button"
                  className="agent-page__suggestion"
                  onClick={() =>
                    composer_ref.current?.write_draft(
                      t("agent_page.empty.suggestions.capabilities"),
                    )
                  }
                >
                  <Sparkles className="agent-page__suggestion-icon" aria-hidden="true" />
                  <span className="agent-page__suggestion-label">
                    {t("agent_page.empty.suggestions.capabilities")}
                  </span>
                </button>
                {FEATURED_AGENT_SKILLS.filter((featured) =>
                  agent.skills.some((skill) => skill.name === featured.name),
                ).map(({ name, suggestionKey, Icon }) => (
                  <button
                    key={name}
                    type="button"
                    className="agent-page__suggestion"
                    onClick={() =>
                      composer_ref.current?.write_draft(
                        `${t(suggestionKey)} ${format_agent_skill_reference(name)}`,
                      )
                    }
                  >
                    <Icon className="agent-page__suggestion-icon" aria-hidden="true" />
                    <span className="agent-page__suggestion-label">
                      {t(suggestionKey)}{" "}
                      <span className="agent-mention-token">
                        <span>{format_agent_skill_reference(name)}</span>
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <AgentTimeline
              entries={agent.entries}
              mention_tokens={mention_tokens}
              follow_latest={follow_latest}
              on_continue={continue_latest_round}
              on_edit={start_edit}
              render_entry_editor={render_entry_editor}
              on_add_annotation={(annotation) =>
                composer_ref.current?.add_response_annotation(annotation)
              }
              revision_disabled={
                agent.command !== null ||
                active_inline_edit !== null ||
                is_running ||
                compacting ||
                compaction_failed ||
                unavailable_reason !== null
              }
              continue_disabled={
                agent.command !== null || is_running || compacting || unavailable_reason !== null
              }
              annotation_disabled={
                agent.command !== null || active_inline_edit !== null || unavailable_reason !== null
              }
            />
          )}
        </div>
      </section>

      <div className="agent-page__composer-stack">
        <Tooltip>
          <TooltipTrigger asChild>
            <AppButton
              type="button"
              className="agent-page__follow-control"
              size="icon-sm"
              variant="outline"
              aria-label={t("agent_page.action.follow_latest")}
              aria-pressed={follow_latest}
              onClick={() => {
                if (follow_latest) {
                  set_follow_latest(false);
                  return;
                }
                activate_follow_latest();
              }}
            >
              <ArrowDownToLine aria-hidden="true" />
            </AppButton>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>
            <p>{t("agent_page.action.follow_latest")}</p>
          </TooltipContent>
        </Tooltip>
        <AgentTaskProgress pending_labels={agent.taskProgress} running={is_running} />
        <AgentInputQueue
          queue={agent.inputQueue}
          disabled={
            agent.command !== null ||
            agent.pendingWriteApproval !== null ||
            active_inline_edit !== null ||
            unavailable_reason !== null ||
            compacting ||
            compaction_failed
          }
          active_edit_item_id={
            active_inline_edit?.kind === "queue" ? active_inline_edit.itemId : null
          }
          render_item_editor={render_queue_editor}
          on_edit={start_queue_edit}
          on_delete={(id) =>
            run_queue_command(() => agent.deleteQueuedMessage(id), "agent_page.error.queue_delete")
          }
          on_reorder={(ids) =>
            run_queue_command(
              () => agent.reorderQueuedMessages(ids),
              "agent_page.error.queue_reorder",
            )
          }
          on_send_now={(id) =>
            run_queue_command(() => agent.sendQueuedMessage(id), "agent_page.error.queue_send")
          }
        />
        {agent.pendingWriteApproval === null ? (
          <AgentComposer
            ref={composer_ref}
            locked={active_inline_edit !== null}
            skills={agent.skills}
            terms={available_terms}
            term_hit_counts={term_hit_counts}
            running={is_running}
            stop_disabled={workspace_apply_running}
            compacting={compacting}
            compaction_failed={compaction_failed}
            unavailable_reason={unavailable_reason}
            command={agent.command}
            can_continue_queue={can_continue_queue}
            can_reset={!agent_restoring && agent.entries.length > 0}
            context_tokens={agent.contextTokens}
            approval_mode={agent.approvalMode}
            approval_mode_disabled={workspace_apply_running}
            model_selection={model_selection}
            input_session={agent.input}
            on_send={submit_message}
            on_thinking_level_change={change_agent_thinking_level}
            on_approval_mode_change={change_approval_mode}
            on_image_error={() => push_toast("error", t("agent_page.error.image"))}
            on_stop={stop}
            on_reset={() => set_reset_dialog_open(true)}
          />
        ) : (
          <AgentApprovalPanel
            pending={agent.pendingWriteApproval}
            on_approve={approve_pending_write}
            on_reject={reject_pending_write}
          />
        )}
      </div>
      <AppConfirmDialog
        open={pending_thinking_off_action !== null}
        description={t("agent_page.confirm.thinking_off")}
        submitting={
          pending_thinking_off_action?.kind === "disable_thinking"
            ? model_selection.updating
            : agent.command === "send"
        }
        onConfirm={confirm_pending_thinking_off_action}
        onClose={close_pending_thinking_off_action}
      />
      <AppConfirmDialog
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
