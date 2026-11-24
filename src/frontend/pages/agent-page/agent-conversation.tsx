import { read_file_paths } from "@frontend/app/desktop/source-paths";
import { useProjectLifecycle } from "@frontend/app/session/project-lifecycle/project-lifecycle-context";
import { ProjectOpenPreviewDialog } from "@frontend/features/project-lifecycle/project-open-preview-dialog";
import { AgentInputDraft } from "@frontend/app/session/agent/agent-input-draft";
import { useDesktopState } from "@frontend/app/state/use-desktop-state";
import { FileDropTarget } from "@frontend/widgets/interactions/file-drop-target";
import { AppContentState } from "@frontend/widgets/app-content-state";
import { push_error_toast, push_toast } from "@frontend/app/feedback/desktop-toast";
import type { AgentApprovalMode } from "@domain/setting";
import { format_agent_reference } from "@shared/agent-reference";
import type { AgentSkillsSnapshot } from "@shared/agent-skills";
import { type JSX, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  BookA,
  BookOpenCheck,
  BookOpenText,
  Bot,
  Drama,
  FileDiff,
  FileOutput,
  Shrink,
  Sparkles,
  Type,
} from "lucide-react";

import type { ModelSelectionInput } from "@shared/model-selection";
import {
  AGENT_INPUT_QUEUE_LIMIT,
  type AgentContextSnapshot,
  type AgentEntry,
  type AgentMessageInput,
  type AgentQueuedInput,
  type AgentSkillSnapshot,
  type AgentUsageSnapshot,
} from "@shared/agent";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-context";
import {
  read_selected_model,
  useModelSelection,
} from "@frontend/features/model-selection/use-model-selection";
import type { SettingsSnapshotPayload } from "@frontend/app/state/desktop-state-context";
import { api_fetch } from "@frontend/app/desktop/desktop-api";
import { useAppNavigation } from "@frontend/app/navigation/navigation-context";
import { format_agent_path_request } from "@frontend/app/navigation/agent-input-steps";
import { AppConfirmDialog } from "@frontend/widgets/app-alert-dialog";
import { AppButton } from "@frontend/widgets/app-button";
import { get_shortcut_aria_keys } from "@frontend/widgets/interactions/keyboard-shortcuts";
import { ShortcutTooltipRow } from "@frontend/widgets/interactions/shortcut-kbd";
import { useActionShortcut } from "@frontend/widgets/interactions/use-action-shortcut";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import {
  useAgentControls,
  useAgentEntry,
  useAgentInput,
  useAgentQueue,
  useAgentChatActions,
  useAgentSkills,
  useAgentTimeline,
} from "@frontend/app/session/agent/agent-chat-context";
import { AgentDecision } from "./agent-decision";
import { AgentLanguageControl } from "./agent-language-control";
import { AgentComposer, type AgentComposerHandle } from "./agent-composer";
import { AgentInlineEditor, type AgentInlineEditTarget } from "./agent-inline-editor";
import { AgentInputQueue } from "./agent-input-queue";
import { type AgentMentionInstruction } from "./agent-mention";
import { AgentTaskStatus } from "./agent-task-status";
import { AgentTimeline } from "./agent-timeline";
import { useAgentFollowLatest } from "./agent-scroll";
import { useAgentInputTransition } from "./use-agent-input-transition";
import "./agent-page.css";

/** 空会话任务入口按配置顺序展示，预置指令不依赖已加载技能。 */
const AGENT_TASK_SUGGESTIONS = [
  {
    skillName: "roleplay",
    suggestionKey: "agent_page.empty.suggestions.roleplay",
    Icon: Drama,
  },
  {
    skillName: "glossary",
    suggestionKey: "agent_page.empty.suggestions.extract_terminology",
    Icon: BookA,
  },
  {
    skillName: "translation",
    suggestionKey: "agent_page.empty.suggestions.translate_full_text",
    Icon: BookOpenText,
  },
  {
    skillName: "translation",
    suggestionKey: "agent_page.empty.suggestions.review_translation",
    Icon: BookOpenCheck,
  },
] as const;
/** 同一个系统确认框承接首条发送与已有对话关闭思考两个用户动作。 */
type PendingThinkingOffAction =
  | { kind: "send"; message: AgentMessageInput }
  | { kind: "select_model"; change: ModelSelectionInput };

const EMPTY_CONTEXT: AgentContextSnapshot = Object.freeze({
  tokens: null,
  limits: null,
  compactable: false,
});
const EMPTY_USAGE: AgentUsageSnapshot = Object.freeze({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
});
const NOOP_STOP = async (): Promise<void> => {};

/** 审批偏好属于应用设置，空态与已打开工程共用同一条写入链路。 */
function useAgentApprovalMode() {
  const { t } = useI18n();
  const { settings_snapshot, apply_settings_snapshot } = useDesktopState();
  const [updating, set_updating] = useState(false);

  const change = useCallback(
    async (approval_mode: AgentApprovalMode): Promise<void> => {
      if (approval_mode === settings_snapshot.agent_approval_mode) return;
      set_updating(true);
      try {
        const payload = await api_fetch<SettingsSnapshotPayload>("/api/settings/update", {
          agent_approval_mode: approval_mode,
        });
        apply_settings_snapshot(payload);
      } catch (error) {
        push_error_toast(t("agent_page.error.approval_mode"), error);
      } finally {
        set_updating(false);
      }
    },
    [apply_settings_snapshot, settings_snapshot.agent_approval_mode, t],
  );

  return {
    mode: settings_snapshot.agent_approval_mode,
    updating,
    change,
  };
}

/** 主 Composer 的宿主指令目录，空态与会话态共用同一结构与文案。 */
function build_agent_instructions(options: {
  t: ReturnType<typeof useI18n>["t"];
  loaded: boolean;
  file_count: number;
  compact_available: boolean;
  compact_unnecessary: boolean;
  append_draft: (text: string, selection?: { from: number; to: number }) => void;
  on_compact: () => void;
}): readonly AgentMentionInstruction[] {
  const { t, loaded } = options;
  return [
    {
      // 翻译成果导出只要求工程中有文件。
      id: "export_translation",
      icon: FileOutput,
      title: t("app.translation_export.action"),
      description: t("agent_page.mention.instructions.export_translation.description"),
      disabled: !loaded || options.file_count === 0,
      execute: () =>
        options.append_draft(
          `${t("app.translation_export.agent_request")} ${format_agent_reference({ kind: "skill", name: "project-operation" })}`,
        ),
    },
    {
      id: "compact_context",
      icon: Shrink,
      title: t("agent_page.mention.instructions.compact_context.title"),
      description: t(
        options.compact_unnecessary
          ? "agent_page.mention.instructions.compact_context.unnecessary"
          : "agent_page.mention.instructions.compact_context.description",
      ),
      disabled: !loaded || !options.compact_available,
      execute: options.on_compact,
    },
    {
      // 只预置草稿，流程由技能决定，不受会话空闲约束。
      id: "update_file",
      icon: FileDiff,
      title: t("agent_page.mention.instructions.update_file.title"),
      description: t("agent_page.mention.instructions.update_file.description"),
      disabled: !loaded,
      execute: () => {
        const request = format_agent_path_request(
          t,
          `${format_agent_reference({ kind: "skill", name: "project-operation" })}\n${t("agent_page.mention.instructions.update_file.request")}`,
          [],
        );
        options.append_draft(request.text, request.selection);
      },
    },
    {
      // 只预置草稿，流程由引擎技能决定，不受会话空闲约束。
      id: "change_game_font",
      icon: Type,
      title: t("game_font_page.title"),
      description: t("agent_page.mention.instructions.change_game_font.description"),
      disabled: !loaded,
      execute: () => {
        const request = format_agent_path_request(
          t,
          t("agent_page.mention.instructions.change_game_font.font_file"),
          [],
          format_agent_path_request(
            t,
            t("agent_page.mention.instructions.change_game_font.game_path"),
            [],
            t("agent_page.mention.instructions.change_game_font.request"),
          ).text,
        );
        options.append_draft(request.text, request.selection);
      },
    },
  ];
}

/** 无工程时复用完整输入底栏、应用级配置与 `@` 技能目录，草稿随页面结束。 */
export function EmptyAgentConversation(): JSX.Element {
  const { t } = useI18n();
  const lifecycle = useProjectLifecycle();
  const model_selection = useModelSelection();
  const approval = useAgentApprovalMode();
  const page_ref = useRef<HTMLDivElement>(null);
  const composer_ref = useRef<AgentComposerHandle>(null);
  const [dropped_project, set_dropped_project] = useState<string | null>(null);
  const [skills, set_skills] = useState<readonly AgentSkillSnapshot[]>([]);
  const [input_state] = useState(() => ({
    revision: 0,
    draft: new AgentInputDraft(),
    read_history: (): readonly string[] => [],
    replace_history: () => {},
  }));

  useEffect(() => {
    const controller = new AbortController();
    void api_fetch<AgentSkillsSnapshot>("/api/skills/snapshot", {}, controller.signal)
      .then((snapshot) => {
        if (controller.signal.aborted) return;
        const seen = new Set<string>();
        const enabled: AgentSkillSnapshot[] = [];
        for (const skill of snapshot.skills) {
          if (!skill.enabled || seen.has(skill.name)) continue;
          seen.add(skill.name);
          enabled.push({ name: skill.name, displayDescriptions: skill.displayDescriptions });
        }
        set_skills(enabled);
      })
      .catch(() => {
        // 空态技能列表属于输入补全增强，加载失败静默降级为空菜单。
      });
    return () => controller.abort();
  }, []);

  /** 空态保留用户输入，通过唯一生命周期提醒入口同步 Toast 与侧栏按钮动效。 */
  function require_project(): false {
    lifecycle.notify_project_required();
    return false;
  }

  const file_drop_enabled = !lifecycle.busy && dropped_project === null;
  /** 单个工程文件进入预览确认，其余素材进入创建工程流程。 */
  function handle_file_drop(files: readonly File[]): void {
    if (!file_drop_enabled || files.length === 0) return;
    const { paths, skipped } = read_file_paths(files);
    if (skipped.length > 0) {
      push_toast("warning", t("agent_page.error.invalid_file_path"), {
        description: skipped.join("\n"),
      });
      return;
    }
    const first = paths[0];
    if (first === undefined) return;
    if (paths.length === 1 && first.toLowerCase().endsWith(".lg")) set_dropped_project(first);
    else lifecycle.create_from_paths(paths);
  }

  const instructions = build_agent_instructions({
    t,
    loaded: false,
    file_count: 0,
    compact_available: false,
    compact_unnecessary: false,
    append_draft: (text, selection) => composer_ref.current?.append_draft(text, selection),
    on_compact: () => {},
  });

  return (
    <div ref={page_ref} className="agent-page">
      <FileDropTarget
        target_ref={page_ref}
        enabled={file_drop_enabled}
        label={t("app.drop.release")}
        on_files={handle_file_drop}
      />
      {dropped_project !== null ? (
        <ProjectOpenPreviewDialog
          path={dropped_project}
          on_close={() => set_dropped_project(null)}
        />
      ) : null}
      <section className="agent-page__conversation" aria-label={t("agent_page.title")}>
        <div className="agent-page__conversation-content">
          <AgentEmptySuggestions
            append_draft={(text) => composer_ref.current?.append_draft(text)}
          />
        </div>
      </section>
      <div className="agent-page__bottom-region">
        <div className="agent-page__input-area">
          <div className="agent-page__operation-zone">
            <div className="agent-page__composer-slot">
              <AgentComposer
                ref={composer_ref}
                placeholder={t("agent_page.input.no_project_placeholder")}
                language_control={null}
                before_attach={require_project}
                on_drop_files={handle_file_drop}
                skills={skills}
                instructions={instructions}
                state="idle"
                stop_disabled={false}
                compacting={false}
                unavailable_reason={null}
                command={null}
                can_continue_queue={false}
                queue_full={false}
                context={EMPTY_CONTEXT}
                usage={EMPTY_USAGE}
                approval_mode={approval.mode}
                approval_disabled={approval.updating}
                model_selection={model_selection}
                input_state={input_state}
                on_send={require_project}
                on_agent_model_select={(change) => {
                  void model_selection.select_model({ target: "agent", ...change });
                  return false;
                }}
                on_approval_mode_change={(mode) => void approval.change(mode)}
                on_stop={NOOP_STOP}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 空白对话和未打开工程时使用同一份建议。 */
function AgentEmptySuggestions({
  append_draft,
}: {
  append_draft: (text: string) => void;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="agent-page__empty">
      <div className="agent-page__empty-intro">
        <Bot className="agent-page__empty-icon" aria-hidden="true" />
        <p className="agent-page__empty-message">{t("agent_page.empty.message")}</p>
      </div>
      <div className="agent-page__suggestions">
        <button
          type="button"
          className="agent-page__suggestion"
          onClick={() => append_draft(t("agent_page.empty.suggestions.capabilities"))}
        >
          <Sparkles className="agent-page__suggestion-icon" aria-hidden="true" />
          <span className="agent-page__suggestion-label">
            {t("agent_page.empty.suggestions.capabilities")}
          </span>
        </button>
        {AGENT_TASK_SUGGESTIONS.map(({ skillName, suggestionKey, Icon }) => (
          <button
            key={suggestionKey}
            type="button"
            className="agent-page__suggestion"
            onClick={() =>
              append_draft(
                `${t(suggestionKey)} ${format_agent_reference({ kind: "skill", name: skillName })}`,
              )
            }
          >
            <Icon className="agent-page__suggestion-icon" aria-hidden="true" />
            <span className="agent-page__suggestion-label">
              {t(suggestionKey)}{" "}
              <span className="agent-mention-token">
                <span>{format_agent_reference({ kind: "skill", name: skillName })}</span>
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** 会话事实由跨路由 Chat Store 提供，页面组合交互入口并持有原位编辑状态。 */
export function AgentConversation({ active = true }: { active?: boolean }): JSX.Element {
  const { t } = useI18n();

  const timeline = useAgentTimeline();
  const controls = useAgentControls();
  const { inputQueue } = useAgentQueue();
  const { skills } = useAgentSkills();
  const input = useAgentInput();
  const { agent_input_request, clear_agent_input_request } = useAppNavigation();
  const consumed_input_request = useRef<typeof agent_input_request>(null); // `StrictMode` 重放副作用时跳过已消费请求。
  const agent_actions = useAgentChatActions();
  const model_selection = useModelSelection();
  const { project_snapshot } = useDesktopState();
  const approval = useAgentApprovalMode();
  const page_ref = useRef<HTMLDivElement | null>(null);
  const conversation_ref = useRef<HTMLElement | null>(null);
  const conversation_content_ref = useRef<HTMLDivElement | null>(null);
  const composer_ref = useRef<AgentComposerHandle | null>(null);
  const {
    following: follow_latest,
    follow_content: follow_conversation_content,
    scroll_to_end: scroll_conversation_to_end,
    activate: activate_conversation_follow,
    deactivate: deactivate_conversation_follow,
    handle_scroll: handle_conversation_scroll,
  } = useAgentFollowLatest(true);
  const [follow_reset_revision, set_follow_reset_revision] = useState(0);
  const [fork_round_id, set_fork_round_id] = useState<string | null>(null); // 弹窗绑定轮次身份，提交时由后端重新校验
  const [pending_thinking_off_action, set_pending_thinking_off_action] =
    useState<PendingThinkingOffAction | null>(null);
  /** 页面只允许一个历史或队列目标进入原位编辑，普通 Composer 始终保持独立草稿。 */
  const [active_inline_edit, set_active_inline_edit] = useState<AgentInlineEditTarget | null>(null);

  useEffect(() => {
    if (!active) {
      set_fork_round_id(null);
      set_pending_thinking_off_action(null);
    }
  }, [active]);

  /** 页面级快捷键与按钮共享同一条跟随切换入口。 */
  const toggle_follow_latest = useCallback((): void => {
    if (follow_latest) {
      deactivate_conversation_follow();
      return;
    }
    set_follow_reset_revision((revision) => revision + 1);
    activate_conversation_follow(conversation_ref.current);
  }, [activate_conversation_follow, deactivate_conversation_follow, follow_latest]);

  useActionShortcut({
    action: "follow_latest",
    enabled: active,
    allow_in_text_editing: true,
    on_trigger: toggle_follow_latest,
  });
  const is_running = controls.state !== "idle";
  const workspace_apply_running = timeline.workspaceApplyRunning;
  const agent_restoring = controls.transport === "restoring";
  const compacting = timeline.compacting;
  // 宿主指令只在会话已恢复、命令已收束且共享运行时空闲时开放。可压缩性直接采用后端事实。
  const instruction_ready =
    controls.transport === "ready" && controls.state === "idle" && controls.command === null;
  const compact_available = instruction_ready && controls.context.compactable;
  // 暂停队列复用 Composer 的 continue 提交，不建立独立恢复控件。
  const can_continue_queue = !is_running && inputQueue.paused && inputQueue.items.length > 0;
  const unavailable_reason =
    controls.transport === "disconnected"
      ? "disconnected"
      : agent_restoring || controls.transport === "restore_failed"
        ? "restoring"
        : null;

  const edit_entry = useAgentEntry(
    active_inline_edit?.kind === "entry" ? active_inline_edit.entryId : null,
  );
  // 换对话、换工程或其它入口替换历史后，原位编辑目标失去事实即自动退出。
  useEffect(() => {
    if (active_inline_edit === null) return;
    const target_exists =
      active_inline_edit.kind === "queue"
        ? inputQueue.items.some((item) => item.id === active_inline_edit.itemId)
        : edit_entry !== undefined;
    if (!target_exists) set_active_inline_edit(null);
  }, [active_inline_edit, edit_entry, inputQueue.items]);

  /** 开启跟随时在布局阶段归底。后续内容变化由统一观察入口接管。 */
  useLayoutEffect(() => {
    const conversation = conversation_ref.current;
    if (active && conversation !== null && follow_latest) scroll_conversation_to_end(conversation);
  }, [active, follow_latest, scroll_conversation_to_end]);

  // 外层只有一个显式滚动写入者。图片、详情与流式内容的尺寸变化共用同一观察入口。
  useLayoutEffect(() => {
    const conversation = conversation_ref.current;
    const content = conversation_content_ref.current;
    if (!active || conversation === null || content === null) return;
    const observer = new ResizeObserver(() => follow_conversation_content(conversation));
    observer.observe(conversation);
    observer.observe(content);
    follow_conversation_content(conversation);
    return () => observer.disconnect();
  }, [active, follow_conversation_content]);

  /** 命令失败只投影为页面 Toast，不写回共享会话状态。 */
  const show_command_error = useCallback(
    (error: unknown, fallback_key: LocaleKey): void => {
      push_error_toast(t(fallback_key), error);
    },
    [t],
  );

  const selected_agent_model = read_selected_model(model_selection, "agent");
  // 公开时间线出现条目才表示用户已经开始当前对话。隐藏会话种子不参与 UI 判断。
  const conversation_started = timeline.entryIds.length > 0;
  /** 只警告支持思考且明确关闭思考的模型，不把能力缺失误报为用户选择。 */
  const thinking_off_confirmation_required =
    !can_continue_queue &&
    !conversation_started &&
    selected_agent_model?.thinking_level === "OFF" &&
    selected_agent_model.available_thinking_levels.includes("OFF");

  /** 页面内所有普通发送共用同一条实际提交出口，确认框只延迟调用它。 */
  const send_message = useCallback(
    async (message: AgentMessageInput): Promise<boolean> => {
      const request = can_continue_queue
        ? agent_actions.continue(
            message.text === "" && message.attachments.length === 0 ? undefined : message,
          )
        : agent_actions.send(message);
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
    [agent_actions, can_continue_queue, show_command_error],
  );

  /** 普通发送继续使用底部 Composer。历史修订已由消息原位编辑器独立承接。 */
  const submit_message = (message: AgentMessageInput): void => {
    if (active_inline_edit !== null) return;
    if (thinking_off_confirmation_required) {
      set_pending_thinking_off_action({ kind: "send", message });
      return;
    }
    void send_message(message);
  };

  /** 已有对话关闭思考前保存选择。返回 true 通知入口让出模态焦点。 */
  const change_agent_model_selection = (change: ModelSelectionInput): boolean => {
    const next_model = model_selection.snapshot.models.find(
      (model) => model.id === change.model_id,
    );
    const next_level = change.thinking_level ?? next_model?.thinking_level;
    if (
      conversation_started &&
      selected_agent_model !== null &&
      selected_agent_model.thinking_level !== "OFF" &&
      next_level === "OFF"
    ) {
      set_pending_thinking_off_action({ kind: "select_model", change });
      return true;
    }
    void model_selection.select_model({ target: "agent", ...change });
    return false;
  };

  /** 菜单与失败块共用宿主压缩入口及错误反馈，菜单筛选文本由 Composer 移除。 */
  const compact_context = useCallback((): void => {
    void agent_actions.compactContext().catch((error: unknown) => {
      show_command_error(error, "agent_page.error.compact");
    });
  }, [agent_actions, show_command_error]);
  const instructions = build_agent_instructions({
    t,
    loaded: true,
    file_count: project_snapshot.file_count,
    compact_available,
    // 会话忙碌时禁用原因不在可压缩性，沿用功能说明。
    compact_unnecessary: instruction_ready && !controls.context.compactable,
    append_draft: (text, selection) => composer_ref.current?.append_draft(text, selection),
    on_compact: compact_context,
  });

  /** 发送失败保留确认框。模型更新沿用通用控制器自身的错误提示与恢复。 */
  const confirm_pending_thinking_off_action = async (): Promise<void> => {
    const action = pending_thinking_off_action;
    if (action === null) return;
    if (action.kind === "select_model") {
      await model_selection.select_model({ target: "agent", ...action.change });
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
  const start_edit = useCallback(
    (entry: Extract<AgentEntry, { kind: "user_message" | "assistant_message" }>): void => {
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
    },
    [],
  );

  /** 原位修订统一走现有后端命令。成功后由编辑器关闭自身。 */
  const save_inline_edit = useCallback(
    async (message: AgentMessageInput): Promise<void> => {
      const target = active_inline_edit;
      if (target === null) return;
      if (target.kind === "queue") {
        await agent_actions.updateQueuedMessage(target.itemId, message);
        input.replace_history(target.message.text, message.text);
        return;
      }
      await agent_actions.reviseRound(target.entryId, message);
      if (target.role === "user") {
        input.replace_history(target.message.text, message.text);
      }
    },
    [active_inline_edit, agent_actions, input],
  );

  /** 保存成功和取消共用同一关闭入口。失败由原位编辑器保留草稿。 */
  const cancel_inline_edit = useCallback((): void => {
    set_active_inline_edit(null);
  }, []);

  /** 时间线与队列只决定编辑目标，共享同一套编辑器装配。 */
  const render_inline_editor = useCallback(
    (target: AgentInlineEditTarget): JSX.Element => {
      return (
        <AgentInlineEditor
          target={target}
          skills={skills}
          command={controls.command}
          unavailable_reason={unavailable_reason}
          on_save={save_inline_edit}
          on_saved={cancel_inline_edit}
          on_cancel={cancel_inline_edit}
        />
      );
    },
    [controls.command, cancel_inline_edit, save_inline_edit, skills, unavailable_reason],
  );

  /** 仅在当前历史目标的位置挂载原位编辑器。 */
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

  /** 仅在当前队列目标的位置挂载原位编辑器。 */
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
  const run_queue_command = (
    command: () => Promise<void>,
    fallback_key: LocaleKey,
  ): Promise<void> => {
    return command().catch((error: unknown) => show_command_error(error, fallback_key));
  };

  /** stop 失败保留运行态，由页面 Toast 提示后允许继续尝试。 */
  const stop = useCallback(async (): Promise<void> => {
    try {
      await agent_actions.stop();
    } catch (error) {
      show_command_error(error, "agent_page.error.stop");
    }
  }, [agent_actions, show_command_error]);

  /** “继续”把所有尾部失败交给后端唯一恢复入口判断并续跑。 */
  const continue_latest_round = useCallback((): void => {
    void agent_actions.continue().catch((error: unknown) => {
      show_command_error(error, "agent_page.error.continue");
    });
  }, [agent_actions, show_command_error]);

  /** 时间线批注写入普通 Composer 草稿，由用户继续编辑和发送。 */
  const add_response_annotation = useCallback(
    (annotation: Parameters<AgentComposerHandle["add_response_annotation"]>[0]): void => {
      composer_ref.current?.add_response_annotation(annotation);
    },
    [],
  );

  // 状态区只在存在内容时占位。容量判断与共享队列上限保持同源。
  const has_input_queue = inputQueue.items.length > 0;
  const queue_full = inputQueue.items.length >= AGENT_INPUT_QUEUE_LIMIT;
  const pending_decision = controls.pendingDecision;
  const input_transition = useAgentInputTransition(pending_decision, composer_ref, active);

  // 会话就绪后尝试写入，编辑器统一判断输入锁。锁状态变化时重新尝试。
  useEffect(() => {
    const request = agent_input_request;
    if (
      !active ||
      !request ||
      consumed_input_request.current === request ||
      controls.transport !== "ready"
    )
      return;
    if (!composer_ref.current?.append_draft(request.text, request.selection)) return;
    consumed_input_request.current = request;
    clear_agent_input_request();
  }, [
    active,
    agent_input_request,
    clear_agent_input_request,
    controls.transport,
    active_inline_edit,
    input_transition.locked,
    controls.command,
  ]);

  const follow_latest_label = t("agent_page.action.follow_latest");
  const follow_latest_status = t("app.tooltip.value", {
    TITLE: follow_latest_label,
    VALUE: t(follow_latest ? "app.state.enabled" : "app.state.disabled"),
  });
  const follow_latest_control = (
    <Tooltip>
      <TooltipTrigger
        render={
          <AppButton
            type="button"
            className="agent-page__follow-control"
            size="icon-sm"
            variant="outline"
            aria-label={follow_latest_label}
            aria-pressed={follow_latest}
            aria-keyshortcuts={get_shortcut_aria_keys("follow_latest")}
            onClick={toggle_follow_latest}
          >
            <ArrowDownToLine aria-hidden="true" />
          </AppButton>
        }
      />
      <TooltipContent>
        <ShortcutTooltipRow label={follow_latest_status} shortcut="follow_latest" />
      </TooltipContent>
    </Tooltip>
  );

  const history_disabled =
    controls.command !== null ||
    is_running ||
    compacting ||
    unavailable_reason !== null ||
    active_inline_edit !== null;

  const file_drop_enabled =
    active && active_inline_edit === null && !input_transition.locked && controls.command === null;
  /** 页面和编辑器都可接入文件，编辑器入口也遵循会话输入状态。 */
  function handle_file_drop(files: readonly File[]): void {
    if (file_drop_enabled && files.length > 0) composer_ref.current?.drop_files(files);
  }

  return (
    <div ref={page_ref} className="agent-page">
      <FileDropTarget
        label={t("app.drop.release")}
        target_ref={page_ref}
        enabled={file_drop_enabled}
        on_files={handle_file_drop}
      />
      <section
        ref={conversation_ref}
        className="agent-page__conversation"
        aria-label={t("agent_page.title")}
        data-following={follow_latest || undefined}
        onScroll={(event) => {
          if (active) handle_conversation_scroll(event.currentTarget);
        }}
      >
        <div ref={conversation_content_ref} className="agent-page__conversation-content">
          {controls.transport === "restore_failed" ? (
            <AppContentState status="error" on_retry={agent_actions.reconnect} />
          ) : agent_restoring ? (
            <div className="agent-page__empty" role="status">
              <div className="agent-page__empty-intro">
                <Bot className="agent-page__empty-icon" aria-hidden="true" />
                <p>{t("agent_page.loading")}</p>
              </div>
            </div>
          ) : timeline.entryIds.length === 0 ? (
            <AgentEmptySuggestions
              append_draft={(text) => composer_ref.current?.append_draft(text)}
            />
          ) : (
            <AgentTimeline
              active={active}
              compact_available={compact_available}
              on_compact={compact_context}
              follow_reset_revision={follow_reset_revision}
              on_continue={is_running || compacting ? undefined : continue_latest_round}
              on_edit={start_edit}
              render_entry_editor={render_entry_editor}
              on_add_annotation={add_response_annotation}
              on_fork={set_fork_round_id}
              fork_disabled={history_disabled}
              revision_disabled={history_disabled}
              continue_disabled={controls.command !== null || unavailable_reason !== null}
              annotation_disabled={
                controls.command !== null ||
                active_inline_edit !== null ||
                unavailable_reason !== null
              }
            />
          )}
        </div>
      </section>

      <div ref={input_transition.region_ref} className="agent-page__bottom-region">
        <div ref={input_transition.area_ref} className="agent-page__input-area">
          <div
            ref={input_transition.status_ref}
            className="agent-page__status-zone"
            inert={input_transition.locked || undefined}
          >
            <AgentTaskStatus doing={controls.doing} running={is_running} />
            {has_input_queue ? (
              <div className="agent-page__status-queue-row">
                <AgentInputQueue
                  queue={inputQueue}
                  disabled={
                    controls.command !== null ||
                    active_inline_edit !== null ||
                    unavailable_reason !== null
                  }
                  active_edit_item_id={
                    active_inline_edit?.kind === "queue" ? active_inline_edit.itemId : null
                  }
                  render_item_editor={render_queue_editor}
                  on_edit={start_queue_edit}
                  on_delete={(id) =>
                    run_queue_command(
                      () => agent_actions.deleteQueuedMessage(id),
                      "app.feedback.delete_failed",
                    )
                  }
                  on_reorder={(ids) =>
                    run_queue_command(
                      () => agent_actions.reorderQueuedMessages(ids),
                      "app.feedback.modify_failed",
                    )
                  }
                  on_send_now={(id) =>
                    run_queue_command(
                      () => agent_actions.sendQueuedMessage(id),
                      "agent_page.error.queue_send",
                    )
                  }
                />
              </div>
            ) : null}
            {follow_latest_control}
          </div>

          <div className="agent-page__operation-zone">
            <div
              ref={input_transition.decision_ref}
              className="agent-page__decision-slot"
              inert={pending_decision === null || undefined}
            >
              {input_transition.visible_decision === null ? null : (
                <AgentDecision
                  decision={input_transition.visible_decision}
                  title_ref={input_transition.title_ref}
                />
              )}
            </div>
            <div
              ref={input_transition.composer_slot_ref}
              className="agent-page__composer-slot"
              inert={input_transition.locked || undefined}
            >
              <AgentComposer
                placeholder={t("agent_page.input.placeholder")}
                language_control={
                  <AgentLanguageControl
                    locked={!active || active_inline_edit !== null || input_transition.locked}
                    disconnected={unavailable_reason === "disconnected"}
                  />
                }
                ref={composer_ref}
                on_drop_files={handle_file_drop}
                locked={!active || active_inline_edit !== null || input_transition.locked}
                skills={skills}
                instructions={instructions}
                state={controls.state}
                stop_disabled={workspace_apply_running}
                compacting={compacting}
                unavailable_reason={unavailable_reason}
                command={controls.command}
                can_continue_queue={can_continue_queue}
                queue_full={queue_full}
                context={controls.context}
                usage={controls.usage}
                approval_mode={approval.mode}
                approval_disabled={approval.updating}
                model_selection={model_selection}
                input_state={input}
                on_send={submit_message}
                on_agent_model_select={change_agent_model_selection}
                on_approval_mode_change={(mode) => void approval.change(mode)}
                on_stop={stop}
              />
            </div>
          </div>
        </div>
      </div>
      <AppConfirmDialog
        open={pending_thinking_off_action !== null}
        description={t("agent_page.confirm.thinking_off")}
        submitting={
          pending_thinking_off_action?.kind === "select_model"
            ? model_selection.updating
            : controls.command === "send"
        }
        onConfirm={confirm_pending_thinking_off_action}
        onClose={close_pending_thinking_off_action}
      />
      <AppConfirmDialog
        open={fork_round_id !== null}
        description={t("agent_page.confirm.fork")}
        submitting={controls.command === "fork"}
        confirmDisabled={history_disabled}
        onConfirm={async () => {
          if (fork_round_id === null) return;
          try {
            await agent_actions.forkRound(fork_round_id);
            set_fork_round_id(null);
          } catch (error) {
            show_command_error(error, "app.feedback.modify_failed");
          }
        }}
        onClose={() => set_fork_round_id(null)}
      />
    </div>
  );
}
