import {
  normalize_source_paths,
  read_file_path,
  read_file_paths,
} from "@frontend/app/desktop/source-paths";
import { useProjectLifecycle } from "@frontend/app/session/project-lifecycle/project-lifecycle-context";
import { ProjectOpenPreviewDialog } from "@frontend/features/project-lifecycle/project-open-preview-dialog";
import type { AgentDraft, AgentStagedFile } from "@frontend/app/session/agent/agent-input-draft";
import { save_project_language_preference } from "@frontend/features/project-lifecycle/project-language-preference";
import { useDesktopState } from "@frontend/app/state/use-desktop-state";
import { FileDropTarget } from "@frontend/widgets/interactions/file-drop-target";
import { AppContentState } from "@frontend/widgets/app-content-state";
import { push_error_toast, push_toast } from "@frontend/app/feedback/desktop-toast";
import type { AgentApprovalMode } from "@domain/setting";
import type { ProjectLanguageSettings } from "@domain/project-settings";
import { find_agent_reference_ranges, format_agent_reference } from "@shared/agent-reference";
import { local_path_to_file_url } from "@shared/agent-workspace-file";
import { PROJECT_FILE_EXTENSION } from "@shared/project/project-file";
import type { AgentSkillsSnapshot } from "@shared/agent-skills";
import {
  type JSX,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
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
import {
  format_agent_path_request,
  format_agent_translation_request,
} from "@frontend/app/navigation/agent-input-steps";
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
  type AgentInputState,
} from "@frontend/app/session/agent/agent-chat-context";
import { AgentDecision } from "./agent-decision";
import { AgentLanguageButton, AgentLanguageControl } from "./agent-language-control";
import { AgentComposer, type AgentComposerHandle } from "./agent-composer";
import { AgentInlineEditor, type AgentInlineEditTarget } from "./agent-inline-editor";
import { AgentInputQueue } from "./agent-input-queue";
import { type AgentMentionInstruction } from "./agent-mention";
import { AgentTaskStatus } from "./agent-task-status";
import { AgentStarPrompt } from "./agent-star-prompt";
import { AgentRoundNavigator } from "./agent-round-navigator";
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
const AGENT_ROUND_JUMP_TOP_OFFSET_PX = 24; // 与消息流顶内边距齐平，跳转后保留呼吸距

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

/** 压缩直接执行会话命令，其余指令在空态与会话态都可预置草稿。 */
function build_agent_instructions(options: {
  t: ReturnType<typeof useI18n>["t"];
  compactable: boolean | null; // 没有空闲会话时为 null，无法判断是否需要压缩。
  append_draft: (text: string, selection?: { from: number; to: number }) => void;
  on_compact: () => void;
}): readonly AgentMentionInstruction[] {
  const { t } = options;
  return [
    {
      id: "compact_context",
      icon: Shrink,
      title: t("agent_page.mention.instructions.compact_context.title"),
      description: t(
        options.compactable === false
          ? "agent_page.mention.instructions.compact_context.unnecessary"
          : "agent_page.mention.instructions.compact_context.description",
      ),
      disabled: options.compactable !== true,
      execute: options.on_compact,
    },
    {
      id: "update_file",
      icon: FileDiff,
      title: t("agent_page.mention.instructions.update_file.title"),
      description: t("agent_page.mention.instructions.update_file.description"),
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
      id: "change_game_font",
      icon: Type,
      title: t("game_font_page.title"),
      description: t("agent_page.mention.instructions.change_game_font.description"),
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
    {
      id: "export_translation",
      icon: FileOutput,
      title: t("app.translation_export.action"),
      description: t("agent_page.mention.instructions.export_translation.description"),
      execute: () =>
        options.append_draft(
          `${t("app.translation_export.agent_request")} ${format_agent_reference({ kind: "skill", name: "project-operation" })}`,
        ),
    },
  ];
}

/** 只警告支持思考且明确关闭思考的模型。 */
function should_confirm_thinking_off(model: ReturnType<typeof read_selected_model>): boolean {
  return model?.thinking_level === "OFF" && model.available_thinking_levels.includes("OFF");
}

/** 预填请求只交给编辑器一次，锁定时等待解锁，选区由编辑器事务应用。 */
function useAgentInputRequest(
  composer_ref: RefObject<AgentComposerHandle | null>,
  enabled: boolean,
) {
  const { agent_input_request, clear_agent_input_request } = useAppNavigation();
  const consumed = useRef<typeof agent_input_request>(null); // 跳过 StrictMode 重放的同一次请求。
  useEffect(() => {
    const request = agent_input_request;
    if (!enabled || request === null || consumed.current === request) return;
    if (!composer_ref.current?.append_draft(request.text, request.selection)) return;
    consumed.current = request;
    clear_agent_input_request();
  }, [agent_input_request, clear_agent_input_request, composer_ref, enabled]);
}

/** 建项保存目录取自当前正文中的本机绝对路径和暂存图片。 */
function collect_effective_anchor_paths(
  draft: AgentDraft,
  staged_files: readonly AgentStagedFile[],
): string[] {
  const paths_in_text = find_agent_reference_ranges(draft.text).flatMap(({ reference }) =>
    reference.kind === "file" && local_path_to_file_url(reference.path) !== null
      ? [reference.path]
      : [],
  );
  return normalize_source_paths([
    ...paths_in_text,
    ...staged_files.flatMap(({ sourcePath }) => (sourcePath === null ? [] : [sourcePath])),
  ]);
}

/** 系统拖放提供本机文件名，只有单个工程文件需要在分流前读取路径。 */
function read_dropped_project(files: readonly File[]): string | null {
  const [file] = files;
  return files.length === 1 && file?.name.toLowerCase().endsWith(PROJECT_FILE_EXTENSION)
    ? read_file_path(file)
    : null;
}

/** 无工程时编辑主窗口草稿，发送后交给新工程所属的 AgentChatStore。 */
export function EmptyAgentConversation({
  input_state,
  languages,
  on_languages_change,
}: {
  input_state: AgentInputState;
  languages: ProjectLanguageSettings;
  on_languages_change: (languages: ProjectLanguageSettings) => void;
}): JSX.Element {
  const { t } = useI18n();
  const lifecycle = useProjectLifecycle();
  const model_selection = useModelSelection();
  const approval = useAgentApprovalMode();
  const page_ref = useRef<HTMLDivElement>(null);
  const composer_ref = useRef<AgentComposerHandle>(null);
  const [dropped_project, set_dropped_project] = useState<string | null>(null);
  const [skills, set_skills] = useState<readonly AgentSkillSnapshot[]>([]);
  const [confirm_thinking_off, set_confirm_thinking_off] = useState(false);
  const locked = lifecycle.busy || confirm_thinking_off || dropped_project !== null;
  useAgentInputRequest(composer_ref, !locked);

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

  /** 页面可能随建项卸载，首条消息交给目标 Store 后才释放窗口草稿。 */
  async function create_and_send(): Promise<void> {
    const draft = input_state.draft.read();
    const staged_files = draft.attachments.filter(
      (attachment) => attachment.kind === "staged_file",
    );
    const project = await lifecycle.create_for_agent({
      languages,
      anchor_paths: collect_effective_anchor_paths(draft, staged_files),
    });
    if (project === null) return;
    const sending = project.agentChat.send_initial_draft({
      text: draft.text.trim(),
      files: staged_files.map(({ file }) => file),
    });
    input_state.draft.clear();
    try {
      await sending;
    } catch (error) {
      push_error_toast(t("agent_page.error.send"), error);
    }
  }

  /** 单个工程文件进入打开预览，翻译素材以路径进入待建项草稿。 */
  function handle_file_drop(files: readonly File[]): void {
    const project = read_dropped_project(files);
    if (project !== null) {
      set_dropped_project(project);
      return;
    }
    const { paths, skipped } = read_file_paths(files);
    const source_paths = normalize_source_paths(paths);
    if (source_paths.length > 0) {
      if (input_state.draft.read().text.trim() === "") {
        composer_ref.current?.append_draft(format_agent_translation_request(t, source_paths).text);
      } else {
        composer_ref.current?.insert_file_references(source_paths);
      }
    }
    if (skipped.length > 0) {
      push_toast("warning", t("agent_page.error.invalid_file_path"), {
        description: skipped.join("\n"),
      });
    }
  }

  const instructions = build_agent_instructions({
    t,
    compactable: null,
    append_draft: (text, selection) => composer_ref.current?.append_draft(text, selection),
    on_compact: () => {},
  });

  return (
    <div ref={page_ref} className="agent-page">
      <FileDropTarget
        target_ref={page_ref}
        enabled={!locked}
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
                locked={locked}
                language_control={
                  <AgentLanguageButton
                    languages={languages}
                    locked={locked}
                    disabled={locked}
                    on_confirm={(next) => {
                      on_languages_change(next);
                      save_project_language_preference(next);
                      return true;
                    }}
                  />
                }
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
                on_send={() => {
                  if (should_confirm_thinking_off(read_selected_model(model_selection, "agent"))) {
                    set_confirm_thinking_off(true);
                  } else {
                    void create_and_send();
                  }
                }}
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
      <AppConfirmDialog
        open={confirm_thinking_off}
        description={t("agent_page.confirm.thinking_off")}
        onConfirm={() => {
          set_confirm_thinking_off(false);
          void create_and_send();
        }}
        onClose={() => set_confirm_thinking_off(false)}
      />
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
  const lifecycle = useProjectLifecycle();
  const agent_actions = useAgentChatActions();
  const model_selection = useModelSelection();
  const approval = useAgentApprovalMode();
  const page_ref = useRef<HTMLDivElement | null>(null);
  const conversation_ref = useRef<HTMLElement | null>(null);
  const conversation_content_ref = useRef<HTMLDivElement | null>(null);
  const composer_ref = useRef<AgentComposerHandle | null>(null);
  const [dropped_project, set_dropped_project] = useState<string | null>(null);
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

  /** 跳转到指定回合前先退出跟随态，避免流式尺寸变化把视口拉回底部。 */
  const jump_to_round = useCallback(
    (round_id: string): void => {
      const conversation = conversation_ref.current;
      if (conversation === null) return;
      deactivate_conversation_follow();
      const target = [...conversation.querySelectorAll<HTMLElement>("[data-agent-round-id]")].find(
        (element) => element.dataset.agentRoundId === round_id,
      );
      if (target === undefined) return;
      const top = Math.max(
        0,
        target.getBoundingClientRect().top -
          conversation.getBoundingClientRect().top +
          conversation.scrollTop -
          AGENT_ROUND_JUMP_TOP_OFFSET_PX,
      );
      const reduced_motion =
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (typeof conversation.scrollTo === "function") {
        conversation.scrollTo({ top, behavior: reduced_motion ? "auto" : "smooth" });
      } else {
        conversation.scrollTop = top;
      }
    },
    [deactivate_conversation_follow],
  );

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
  const compactable =
    controls.transport === "ready" && controls.state === "idle" && controls.command === null
      ? controls.context.compactable
      : null;
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
  const thinking_off_confirmation_required =
    !can_continue_queue &&
    !conversation_started &&
    should_confirm_thinking_off(selected_agent_model);

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
    compactable,
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

  const composer_locked =
    !active ||
    lifecycle.busy ||
    active_inline_edit !== null ||
    input_transition.locked ||
    dropped_project !== null;
  useAgentInputRequest(
    composer_ref,
    !composer_locked && controls.transport === "ready" && controls.command === null,
  );

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

  const file_drop_enabled = !composer_locked && controls.command === null;
  /** 整个对话页先识别工程文件，其它文件交给主输入。 */
  function handle_file_drop(files: readonly File[]): void {
    const project = read_dropped_project(files);
    if (project !== null) {
      set_dropped_project(project);
    } else {
      composer_ref.current?.insert_files(files);
    }
  }

  return (
    <div ref={page_ref} className="agent-page">
      <FileDropTarget
        label={t("app.drop.release")}
        target_ref={page_ref}
        enabled={file_drop_enabled}
        on_files={handle_file_drop}
      />
      {dropped_project !== null ? (
        <ProjectOpenPreviewDialog
          path={dropped_project}
          on_close={() => set_dropped_project(null)}
        />
      ) : null}
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
              compact_available={compactable === true}
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
      {conversation_started ? (
        <AgentRoundNavigator
          active={active}
          conversation_ref={conversation_ref}
          on_jump={jump_to_round}
        />
      ) : null}

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
            {/* 恢复快照可能直接换到新的导出轮次，按轮次重新挂载提醒。 */}
            {controls.exportedRoundId !== null ? (
              <AgentStarPrompt key={controls.exportedRoundId} />
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
                  // 离场内容仍挂载，只让前台待决卡片响应 Esc。
                  active={active && pending_decision !== null}
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
                    locked={composer_locked}
                    disconnected={unavailable_reason === "disconnected"}
                  />
                }
                ref={composer_ref}
                locked={composer_locked}
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
