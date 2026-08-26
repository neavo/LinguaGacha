import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import {
  BookA,
  Brain,
  Boxes,
  ChevronDown,
  ImagePlus,
  LoaderCircle,
  MessageSquarePlus,
  Send,
  ShieldCheck,
  ShieldQuestionMark,
  Sparkles,
  Square,
} from "lucide-react";

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  Annotation,
  Compartment,
  EditorSelection,
  EditorState,
  StateEffect,
  StateField,
  Transaction,
  type Extension,
  type TransactionSpec,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  drawSelection,
  keymap,
  placeholder,
  type DecorationSet,
} from "@codemirror/view";

import type { ModelThinkingLevel } from "@domain/model";
import { AGENT_COMPACTION_RESERVE_TOKENS } from "@domain/model-agent";
import type { GlossaryEntry } from "@domain/quality";
import {
  AGENT_INPUT_QUEUE_LIMIT,
  AGENT_MESSAGE_IMAGE_LIMIT,
  type AgentMessageAttachment,
  type AgentMessageInput,
  type AgentApprovalMode,
  type AgentResponseAnnotationAttachment,
  type AgentSkillSnapshot,
} from "@shared/agent";
import { useAppearance } from "@frontend/app/appearance/appearance-provider";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-provider";
import {
  ModelSelectionCategories,
  ModelThinkingLevelOptions,
} from "@frontend/features/model-selection/model-selection-menu";
import { MODEL_THINKING_LEVEL_LABEL_KEY } from "@frontend/features/model-selection/model-selection-meta";
import {
  read_selected_model,
  type ModelSelectionController,
} from "@frontend/features/model-selection/use-model-selection";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  tooltip_trigger_target,
} from "@frontend/shadcn/tooltip";
import { AppButton } from "@frontend/widgets/app-button";
import {
  AppDropdownMenu,
  AppDropdownMenuContent,
  AppDropdownMenuRadioGroup,
  AppDropdownMenuRadioItem,
  AppDropdownMenuTrigger,
} from "@frontend/widgets/app-dropdown-menu";
import {
  resolve_app_editor_readonly_extensions,
  resolve_app_editor_theme_extensions,
} from "@frontend/widgets/app-editor/app-editor-code-mirror";
import { get_shortcut_label } from "@frontend/widgets/interactions/keyboard-shortcuts";
import { ShortcutKbd } from "@frontend/widgets/interactions/shortcut-kbd";
import { useActionShortcut } from "@frontend/widgets/interactions/use-action-shortcut";
import type {
  AgentCommand,
  AgentInputSession,
} from "@frontend/app/session/agent/agent-session-context";
import {
  create_agent_mention_candidates,
  create_agent_mention_tokens,
  find_agent_mention_ranges,
  type AgentMentionCandidate,
  type AgentMentionToken,
} from "./agent-mention";
import { AGENT_IMAGE_FILE_ACCEPT, normalize_agent_images } from "./agent-image";
import { AgentMessageAttachments } from "./agent-message-attachments";

/** 光标前当前 @ 查询范围。 */
type MentionQuery = {
  from: number;
  to: number;
  text: string;
};

/** React 只持有渲染所需投影，正文仍由 EditorState 唯一拥有。 */
type EditorSnapshot = {
  text: string;
  query: MentionQuery | null;
};

/** 页面只能写入草稿并请求聚焦，正文与光标所有权仍留在 CodeMirror。 */
export type AgentComposerHandle = {
  write_draft: (text: string) => void;
  add_response_annotation: (annotation: AgentResponseAnnotationAttachment) => void;
  focus: () => void;
};

/** 互斥于发送的新命令原因；三种状态都允许继续编辑本地草稿。 */
type AgentUnavailableReason = "restoring" | "runtime_busy" | "settling";

type AgentComposerProps = {
  ref?: Ref<AgentComposerHandle>;
  /** 原位编辑复用编辑能力，但不携带普通 Composer 的模型、重置和队列操作。 */
  presentation?: "composer" | "inline";
  inline_role?: "user" | "assistant";
  on_cancel_edit?: () => void;
  locked?: boolean;
  skills: readonly AgentSkillSnapshot[];
  terms: readonly GlossaryEntry[];
  term_hit_counts: Readonly<Record<string, number>>;
  running: boolean;
  stop_disabled: boolean; // 当前原子阶段只禁用 stop，不锁定草稿编辑
  compacting: boolean;
  compaction_failed: boolean;
  unavailable_reason: AgentUnavailableReason | null;
  command: AgentCommand;
  can_continue_queue: boolean;
  queue_full: boolean;
  can_reset: boolean;
  context_tokens: number | null;
  approval_mode?: AgentApprovalMode;
  approval_mode_disabled?: boolean;
  model_selection: ModelSelectionController;
  input_session: AgentInputSession;
  on_send: (message: AgentMessageInput) => void;
  on_thinking_level_change?: (thinking_level: ModelThinkingLevel) => void; // 主 Composer 交给页面决定是否确认关闭思考
  on_approval_mode_change?: (approval_mode: AgentApprovalMode) => void;
  on_image_error: () => void;
  on_stop: () => Promise<void>;
  on_reset: () => void;
};

/** 命令不可用原因同时驱动禁用态和提示，禁止平行布尔量产生矛盾组合。 */
const AGENT_UNAVAILABLE_REASON_KEYS = Object.freeze({
  restoring: "agent_page.unavailable.restoring",
  runtime_busy: "agent_page.unavailable.runtime_busy",
  settling: "agent_page.unavailable.settling",
} satisfies Readonly<Record<AgentUnavailableReason, LocaleKey>>);

const EMPTY_EDITOR_SNAPSHOT: EditorSnapshot = {
  text: "",
  query: null,
};
/** 撤销标记只控制 CodeMirror 历史；此标记单独标识 Composer 的历史导航事务。 */
const input_history_navigation_annotation = Annotation.define<boolean>();
const input_history_navigation_annotations = [
  Transaction.addToHistory.of(false),
  input_history_navigation_annotation.of(true),
];
/** Session 受理后的草稿同步不进入撤销栈，也不冒充用户编辑。 */
const input_session_sync_annotations = [Transaction.addToHistory.of(false)];

// 三个 Compartment 只承接运行期配置，不参与草稿事实。
const theme_compartment = new Compartment();
const read_only_compartment = new Compartment();
const placeholder_compartment = new Compartment();

/** mention 配置与 Decoration 都可由当前能力、术语和纯文本正文重建。 */
const set_mention_tokens_effect = StateEffect.define<readonly AgentMentionToken[]>();
const mention_token_config_field = StateField.define<readonly AgentMentionToken[]>({
  create: () => [],
  update(tokens, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(set_mention_tokens_effect)) return effect.value;
    }
    return tokens;
  },
});
const mention_tokens_field = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(tokens, transaction) {
    let config = transaction.startState.field(mention_token_config_field);
    let config_changed = false;
    for (const effect of transaction.effects) {
      if (!effect.is(set_mention_tokens_effect)) continue;
      config = effect.value;
      config_changed = true;
    }
    if (!transaction.docChanged && !config_changed) return tokens;
    return create_mention_token_decorations(transaction.newDoc.toString(), config);
  },
  provide(field) {
    return [
      EditorView.decorations.from(field),
      EditorView.atomicRanges.of((view) => view.state.field(field)),
    ];
  },
});
const mention_token_extension: Extension = [mention_token_config_field, mention_tokens_field];

/** 页面私有的纯文本消息编辑器，不把 Agent 领域状态泄漏到通用 AppEditor。 */
/** AGENT 主输入器与原位编辑器共享正文、附件和键盘交互，页面只提供命令入口。 */
export function AgentComposer(props: AgentComposerProps): JSX.Element {
  const { locale, t } = useI18n();
  const { resolved_theme } = useAppearance();
  // inline 由页面拥有目标草稿；locked 只冻结当前 Composer，不改变共享会话事实。
  const inline = props.presentation === "inline";
  const approval_mode = props.approval_mode ?? "manual";
  const locked = props.locked === true;
  const assistant_editing = inline && props.inline_role === "assistant";
  const placeholder_text = t(
    assistant_editing
      ? "agent_page.input.edit_assistant_placeholder"
      : "agent_page.input.placeholder",
  );
  const compacting = props.compacting;
  const submit_command_active =
    props.command === "send" ||
    props.command === "continue" ||
    props.command === "revise" ||
    props.command === "queue_update" ||
    props.command === "stop";
  const host_ref = useRef<HTMLDivElement | null>(null);
  const file_input_ref = useRef<HTMLInputElement | null>(null);
  const menu_ref = useRef<HTMLDivElement | null>(null);
  const view_ref = useRef<EditorView | null>(null);
  const submit_ref = useRef<() => void>(() => undefined);
  // CodeMirror 扩展只创建一次，ref 保证 Escape 调用最新的页面取消入口。
  const cancel_edit_ref = useRef(props.on_cancel_edit);
  const select_candidate_ref = useRef<(candidate: AgentMentionCandidate) => void>(() => undefined);
  const menu_open_ref = useRef(false);
  const matching_candidates_ref = useRef<readonly AgentMentionCandidate[]>([]);
  const menu_index_ref = useRef(0);
  const last_query_key_ref = useRef("");
  // CodeMirror 回调从 ref 读取最新跨路由输入状态；历史索引只属于当前 Composer。
  const input_session_ref = useRef(props.input_session);
  const input_history_index_ref = useRef<number | null>(null);
  // 附件 ref 负责异步批次的顺序与同步判定，React state 只负责渲染当前投影。
  const draft_attachments_ref = useRef(
    structuredClone(props.input_session.read_draft().attachments),
  );
  const image_processing_ref = useRef(false);
  const image_drag_depth_ref = useRef(0);
  const [snapshot, set_snapshot] = useState<EditorSnapshot>(EMPTY_EDITOR_SNAPSHOT);
  const [draft_attachments, set_draft_attachments] = useState<AgentMessageAttachment[]>(() => [
    ...draft_attachments_ref.current,
  ]);
  const [image_processing, set_image_processing] = useState(false);
  const [image_drop_active, set_image_drop_active] = useState(false);
  const [menu_index_value, set_menu_index] = useState(0);
  const [menu_suppressed, set_menu_suppressed] = useState(false);

  const mention_query_text = snapshot.query?.text;
  const candidate_groups =
    assistant_editing || mention_query_text === undefined
      ? { skills: [], terms: [] }
      : create_agent_mention_candidates({
          query: mention_query_text,
          locale,
          skills: props.skills,
          terms: props.terms,
          term_hit_counts: props.term_hit_counts,
          format_term_hits: (count) =>
            t("agent_page.mention.term_hits", { count: count.toString() }),
        });
  const matching_skills = candidate_groups.skills;
  const matching_terms = candidate_groups.terms;
  const matching_candidates = [...matching_skills, ...matching_terms];
  const editor_read_only =
    locked ||
    props.command === "send" ||
    props.command === "continue" ||
    props.command === "revise" ||
    props.command === "queue_update" ||
    props.command === "reset";
  const menu_open =
    !assistant_editing && snapshot.query !== null && !editor_read_only && !menu_suppressed;
  const menu_index = Math.max(0, Math.min(menu_index_value, matching_candidates.length - 1));
  const has_sendable_content =
    snapshot.text !== "" || (!assistant_editing && draft_attachments.length > 0);
  const continuing_queue = props.can_continue_queue && !props.running && !inline && !locked;
  // 主按钮只表达稳定动作：运行中有内容发送、空内容停止，暂停队列统一继续。
  const stopping = props.running && !has_sendable_content && !inline && !locked;
  // 满队列只阻止会新增输入的动作；停止、保存和编辑不受容量提示影响。
  const queue_full_for_submit =
    props.queue_full &&
    has_sendable_content &&
    ((props.running && !inline && !locked) || continuing_queue);
  // 按钮与全局快捷键消费同一可用性，避免锁定态仍能从键盘重置会话。
  const new_task_available =
    !inline &&
    props.can_reset &&
    !locked &&
    !props.running &&
    !compacting &&
    props.unavailable_reason === null &&
    props.command === null;
  useActionShortcut({
    action: "create",
    enabled: new_task_available,
    allow_in_text_editing: true,
    on_trigger: props.on_reset,
  });
  let submit_label_key: LocaleKey = "agent_page.action.send";
  const can_submit =
    !locked &&
    props.unavailable_reason === null &&
    props.command === null &&
    !props.model_selection.updating &&
    !image_processing &&
    (has_sendable_content || continuing_queue) &&
    (!props.compaction_failed || continuing_queue) &&
    !queue_full_for_submit;
  if (queue_full_for_submit) submit_label_key = "agent_page.queue.full";
  else if (continuing_queue) submit_label_key = "agent_page.action.continue";
  else if (props.running && has_sendable_content && !inline)
    submit_label_key = "agent_page.action.send";
  else if (compacting) submit_label_key = "agent_page.compaction.running";
  else if (props.running && props.stop_disabled) submit_label_key = "agent_page.action.applying";
  else if (inline) submit_label_key = "app.action.save";
  else if (stopping) submit_label_key = "agent_page.action.stop";
  const contextual_submit_label = queue_full_for_submit
    ? t("agent_page.queue.full", {
        count: AGENT_INPUT_QUEUE_LIMIT.toString(),
        limit: AGENT_INPUT_QUEUE_LIMIT.toString(),
      })
    : t(submit_label_key);
  const image_count = draft_attachments.reduce(
    (count, attachment) => count + (attachment.kind === "image" ? 1 : 0),
    0,
  );
  const image_limit_reached = image_count >= AGENT_MESSAGE_IMAGE_LIMIT;
  // 运行命令与模型快照请求分开表达，避免把加载态误当成 Agent 会话锁。
  const model_commands_disabled =
    locked ||
    props.running ||
    compacting ||
    props.unavailable_reason !== null ||
    props.command !== null;
  const model_controls_disabled =
    model_commands_disabled || props.model_selection.loading || props.model_selection.updating;
  const approval_mode_disabled =
    inline ||
    props.approval_mode_disabled === true ||
    props.command !== null ||
    props.unavailable_reason !== null;
  const selected_model = read_selected_model(props.model_selection, "agent");
  const selected_model_name =
    selected_model?.name || selected_model?.id || t("app.model.selection.unavailable");
  const selected_thinking_available =
    selected_model !== null &&
    selected_model.available_thinking_levels.includes(selected_model.thinking_level);
  const thinking_unavailable =
    selected_model !== null && selected_model.available_thinking_levels.length === 0;
  const selected_thinking_label =
    selected_model === null
      ? null
      : selected_thinking_available
        ? t(MODEL_THINKING_LEVEL_LABEL_KEY[selected_model.thinking_level])
        : t("app.model.thinking_level.default");
  const approval_mode_label = t(
    approval_mode === "auto" ? "agent_page.approval.auto" : "agent_page.approval.manual",
  );
  const approval_mode_tooltip = t(
    approval_mode === "auto"
      ? "agent_page.approval.tooltip_auto"
      : "agent_page.approval.tooltip_manual",
  );
  const ApprovalModeIcon = approval_mode === "auto" ? ShieldCheck : ShieldQuestionMark;
  const model_selection_label = t("app.model.selection.label");
  const model_selection_aria_label = `${model_selection_label}: ${selected_model_name}`;
  // 后端只拥有历史 token；容量跟随当前选择，并会在下一次模型操作前同步到既有会话。
  const context_usage =
    selected_model === null
      ? null
      : format_context_usage({
          tokens: props.context_tokens ?? 0,
          contextWindow: selected_model.agent_limits.context_window,
          maxTokens: selected_model.agent_limits.max_output_tokens,
        });
  // 编辑器只创建一次，首次锁定态必须在首帧扩展中生效，不能等待后续 effect。
  const initial_editor_read_only_ref = useRef(editor_read_only);
  const input_revision = props.input_session.revision;

  menu_open_ref.current = menu_open;
  matching_candidates_ref.current = matching_candidates;
  menu_index_ref.current = menu_index;
  input_session_ref.current = props.input_session;
  cancel_edit_ref.current = props.on_cancel_edit;

  useEffect(() => {
    const host = host_ref.current;
    if (host === null) return;
    const emit_snapshot = (state: EditorState): void => {
      const next = read_editor_snapshot(state);
      const query_key =
        next.query === null
          ? ""
          : `${next.query.from.toString()}:${next.query.to.toString()}:${next.query.text}`;
      if (query_key !== last_query_key_ref.current) {
        last_query_key_ref.current = query_key;
        set_menu_index(0);
        set_menu_suppressed(false);
      }
      set_snapshot(next);
    };
    const editor = new EditorView({
      parent: host,
      state: EditorState.create({
        extensions: [
          theme_compartment.of(resolve_app_editor_theme_extensions(resolved_theme, "plain")),
          read_only_compartment.of(
            resolve_app_editor_readonly_extensions(initial_editor_read_only_ref.current),
          ),
          placeholder_compartment.of(placeholder(placeholder_text)),
          mention_token_extension,
          drawSelection(),
          history(),
          EditorView.lineWrapping,
          EditorView.domEventHandlers({
            blur: () => set_menu_suppressed(true),
            keydown: (event) => event.key === "Enter" && event.isComposing,
          }),
          keymap.of([
            {
              key: "ArrowDown",
              run: (view) =>
                inline
                  ? false
                  : menu_open_ref.current
                    ? navigate_mention_menu(1)
                    : navigate_input_history(view, "newer"),
            },
            {
              key: "ArrowUp",
              run: (view) =>
                inline
                  ? false
                  : menu_open_ref.current
                    ? navigate_mention_menu(-1)
                    : navigate_input_history(view, "older"),
            },
            {
              key: "Escape",
              run: () => {
                if (menu_open_ref.current) {
                  set_menu_suppressed(true);
                  return true;
                }
                if (!inline) return false;
                cancel_edit_ref.current?.();
                return true;
              },
            },
            {
              key: "Enter",
              run: (view) => {
                if (view.composing) return true;
                const candidate = matching_candidates_ref.current[menu_index_ref.current];
                if (menu_open_ref.current && candidate !== undefined) {
                  select_candidate_ref.current(candidate);
                } else submit_ref.current();
                return true;
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged || update.selectionSet) {
              if (
                update.docChanged &&
                !update.transactions.every(
                  (transaction) =>
                    transaction.annotation(input_history_navigation_annotation) === true,
                )
              ) {
                input_history_index_ref.current = null;
                input_session_ref.current.write_draft({
                  text: update.state.doc.toString(),
                  attachments: draft_attachments_ref.current,
                });
              }
              emit_snapshot(update.state);
            }
          }),
        ],
      }),
    });
    editor.contentDOM.setAttribute("aria-label", placeholder_text);
    editor.contentDOM.setAttribute("aria-multiline", "true");
    editor.contentDOM.setAttribute("spellcheck", "false");
    view_ref.current = editor;
    emit_snapshot(editor.state);
    return () => {
      editor.destroy();
      view_ref.current = null;
    };
  }, []);

  useEffect(() => {
    const view = view_ref.current;
    if (view === null) return;
    input_history_index_ref.current = null;
    const draft = input_session_ref.current.read_draft();
    draft_attachments_ref.current = structuredClone(draft.attachments);
    set_draft_attachments([...draft_attachments_ref.current]);
    write_agent_message_text(view, draft.text, input_session_sync_annotations);
  }, [input_revision]);

  useEffect(() => {
    view_ref.current?.dispatch({
      effects: set_mention_tokens_effect.of(create_agent_mention_tokens(props.skills, props.terms)),
      annotations: input_session_sync_annotations,
    });
  }, [props.skills, props.terms]);

  useEffect(() => {
    view_ref.current?.dispatch({
      effects: theme_compartment.reconfigure(
        resolve_app_editor_theme_extensions(resolved_theme, "plain"),
      ),
    });
  }, [resolved_theme]);

  useEffect(() => {
    const view = view_ref.current;
    if (view === null) return;
    view.dispatch({
      effects: read_only_compartment.reconfigure(
        resolve_app_editor_readonly_extensions(editor_read_only),
      ),
    });
  }, [editor_read_only]);

  useEffect(() => {
    const view = view_ref.current;
    if (view === null) return;
    view.dispatch({
      effects: placeholder_compartment.reconfigure(placeholder(placeholder_text)),
    });
    view.contentDOM.setAttribute("aria-label", placeholder_text);
  }, [placeholder_text]);

  useEffect(() => {
    const content = view_ref.current?.contentDOM;
    if (content === undefined) return;
    content.setAttribute("role", "combobox");
    content.setAttribute("aria-haspopup", "listbox");
    content.setAttribute("aria-expanded", menu_open ? "true" : "false");
    if (menu_open) {
      content.setAttribute("aria-controls", "agent-mention-menu");
      if (matching_candidates[menu_index] === undefined) {
        content.removeAttribute("aria-activedescendant");
      } else {
        content.setAttribute(
          "aria-activedescendant",
          `agent-mention-option-${menu_index.toString()}`,
        );
      }
    } else {
      content.removeAttribute("aria-controls");
      content.removeAttribute("aria-activedescendant");
    }
  }, [matching_candidates, menu_index, menu_open]);

  useEffect(() => {
    if (!menu_open) return;
    // aria-activedescendant 不会移动 DOM 焦点，必须显式保持键盘活动项可见。
    menu_ref.current
      ?.querySelector<HTMLElement>(`#agent-mention-option-${menu_index.toString()}`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [mention_query_text, menu_index, menu_open]);

  /** 用一次事务把当前 @ 查询替换成字面量 marker 与结束空格。 */
  const select_candidate = (candidate: AgentMentionCandidate): void => {
    const view = view_ref.current;
    const query = view === null ? null : find_mention_query(view.state);
    if (view === null || query === null) return;
    const text = `${candidate.insertText} `;
    view.dispatch({
      changes: { from: query.from, to: query.to, insert: text },
      selection: EditorSelection.cursor(query.from + text.length),
    });
    set_menu_suppressed(false);
    view.focus();
  };
  select_candidate_ref.current = select_candidate;

  /** 同步更新异步判定、可见附件与跨路由草稿，唯一数组同时拥有混排顺序。 */
  const write_draft_attachments = useCallback((attachments: AgentMessageAttachment[]): void => {
    draft_attachments_ref.current = attachments;
    set_draft_attachments(attachments);
    input_session_ref.current.write_draft({
      text: view_ref.current?.state.doc.toString() ?? input_session_ref.current.read_draft().text,
      attachments,
    });
  }, []);

  /** 三类输入共用原生转换入口；同步锁避免同一帧重复批次打乱图片顺序。 */
  const append_image_files = async (files: Iterable<File>): Promise<void> => {
    if (assistant_editing || image_processing_ref.current) return;
    const current_image_count = draft_attachments_ref.current.filter(
      (attachment) => attachment.kind === "image",
    ).length;
    const remaining_slots = AGENT_MESSAGE_IMAGE_LIMIT - current_image_count;
    if (remaining_slots <= 0) return;
    const input_files = Array.from(files).slice(0, remaining_slots);
    if (input_files.length === 0) return;
    image_processing_ref.current = true;
    set_image_processing(true);
    try {
      const images = await normalize_agent_images(input_files);
      const current = draft_attachments_ref.current;
      const available_slots =
        AGENT_MESSAGE_IMAGE_LIMIT -
        current.filter((attachment) => attachment.kind === "image").length;
      write_draft_attachments([
        ...current,
        ...images
          .slice(0, available_slots)
          .map<AgentMessageAttachment>((webpBase64) => ({ kind: "image", webpBase64 })),
      ]);
    } catch {
      props.on_image_error();
    } finally {
      image_processing_ref.current = false;
      set_image_processing(false);
    }
  };

  /** 嵌套元素产生的 dragenter / dragleave 通过深度归零后统一关闭遮罩。 */
  const reset_image_drop = (): void => {
    image_drag_depth_ref.current = 0;
    set_image_drop_active(false);
  };

  const remove_attachment = (index: number): void => {
    write_draft_attachments(
      draft_attachments_ref.current.filter((_, attachment_index) => attachment_index !== index),
    );
  };

  /** 附件组件只提交用户意图，Composer 仍在当前权威草稿中按原索引写入。 */
  const update_annotation = (index: number, comment: string): void => {
    const current = draft_attachments_ref.current;
    const annotation = current[index];
    if (annotation?.kind !== "response_annotation") return;
    write_draft_attachments(
      current.map((attachment, attachment_index) =>
        attachment_index === index ? { ...annotation, comment } : attachment,
      ),
    );
  };

  useImperativeHandle(
    props.ref,
    () => ({
      write_draft(text) {
        const view = view_ref.current;
        if (view === null || editor_read_only) return;
        input_history_index_ref.current = null;
        write_agent_message_text(view, text);
        view.focus();
      },
      add_response_annotation(annotation) {
        if (editor_read_only || assistant_editing) return;
        write_draft_attachments([...draft_attachments_ref.current, structuredClone(annotation)]);
        view_ref.current?.focus();
      },
      focus() {
        view_ref.current?.focus();
      },
    }),
    [assistant_editing, editor_read_only, write_draft_attachments],
  );

  /** Composer 只提交当前投影；受理后的历史与草稿由常驻 Agent session 原子更新。 */
  const submit = (): void => {
    const view = view_ref.current;
    if (view === null || !can_submit) return;
    const text = view.state.doc.toString().trim();
    props.on_send({ text, attachments: structuredClone(draft_attachments_ref.current) });
  };
  submit_ref.current = submit;

  return (
    <form
      className={`agent-operation-surface agent-composer${inline ? " agent-composer--inline" : ""}`}
      data-image-drop-active={image_drop_active ? "true" : undefined}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      onPaste={(event) => {
        if (editor_read_only || assistant_editing || event.clipboardData.files.length === 0) return;
        event.preventDefault();
        void append_image_files(event.clipboardData.files);
      }}
      onDragEnter={(event) => {
        if (
          editor_read_only ||
          assistant_editing ||
          !Array.from(event.dataTransfer.types).includes("Files")
        ) {
          return;
        }
        event.preventDefault();
        if (image_limit_reached) return;
        image_drag_depth_ref.current += 1;
        set_image_drop_active(true);
      }}
      onDragOver={(event) => {
        if (
          editor_read_only ||
          assistant_editing ||
          !Array.from(event.dataTransfer.types).includes("Files")
        ) {
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = image_limit_reached ? "none" : "copy";
      }}
      onDragLeave={(event) => {
        if (!Array.from(event.dataTransfer.types).includes("Files")) return;
        event.preventDefault();
        image_drag_depth_ref.current = Math.max(0, image_drag_depth_ref.current - 1);
        if (image_drag_depth_ref.current === 0) set_image_drop_active(false);
      }}
      onDrop={(event) => {
        if (!Array.from(event.dataTransfer.types).includes("Files")) return;
        event.preventDefault();
        reset_image_drop();
        if (!editor_read_only && !assistant_editing)
          void append_image_files(event.dataTransfer.files);
      }}
    >
      {menu_open && (
        <div ref={menu_ref} id="agent-mention-menu" className="agent-mention-menu" role="listbox">
          {matching_skills.length > 0 && (
            <div
              className="agent-mention-menu__group"
              role="group"
              aria-labelledby="agent-mention-skills-label"
            >
              <div id="agent-mention-skills-label" className="agent-mention-menu__group-label">
                {t("agent_page.mention.groups.skills")}
              </div>
              {matching_skills.map((candidate, index) => render_candidate(candidate, index))}
            </div>
          )}
          {matching_terms.length > 0 && (
            <div
              className="agent-mention-menu__group"
              role="group"
              aria-labelledby="agent-mention-terms-label"
            >
              <div id="agent-mention-terms-label" className="agent-mention-menu__group-label">
                {t("agent_page.mention.groups.terms")}
              </div>
              {matching_terms.map((candidate, index) =>
                render_candidate(candidate, matching_skills.length + index),
              )}
            </div>
          )}
          {matching_candidates.length === 0 && (
            <p className="agent-mention-menu__empty">{t("agent_page.mention.no_matches")}</p>
          )}
        </div>
      )}
      {!assistant_editing && draft_attachments.length > 0 ? (
        /* 权威草稿 revision 变化时重建局部展开态，避免旧索引指向新附件。 */
        <AgentMessageAttachments
          key={input_revision}
          mode="draft"
          attachments={draft_attachments}
          disabled={editor_read_only || image_processing}
          on_update_annotation={update_annotation}
          on_remove={remove_attachment}
        />
      ) : null}
      <div className="agent-composer__editor">
        <div ref={host_ref} className="agent-composer__input" />
      </div>
      <input
        ref={file_input_ref}
        className="agent-composer__file-input"
        type="file"
        accept={AGENT_IMAGE_FILE_ACCEPT}
        multiple
        tabIndex={-1}
        onChange={(event) => {
          void append_image_files(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
        }}
      />
      <div className="agent-composer__drop-overlay" aria-hidden={!image_drop_active}>
        {t("agent_page.input.drop_images")}
      </div>
      <div className="agent-composer__footer">
        <div className="agent-composer__footer-actions">
          {!assistant_editing ? (
            <Tooltip>
              <TooltipTrigger asChild>
                {tooltip_trigger_target(
                  <AppButton
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    className="agent-composer__image-trigger"
                    disabled={editor_read_only || image_processing || image_limit_reached}
                    aria-label={t("agent_page.action.add_image")}
                    onClick={() => file_input_ref.current?.click()}
                  >
                    {image_processing ? (
                      <LoaderCircle className="animate-spin" aria-hidden="true" />
                    ) : (
                      <ImagePlus aria-hidden="true" />
                    )}
                  </AppButton>,
                )}
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={8}>
                <p>{t("agent_page.action.add_image")}</p>
              </TooltipContent>
            </Tooltip>
          ) : null}
          {!inline ? (
            <Tooltip>
              <TooltipTrigger asChild>
                {tooltip_trigger_target(
                  <AppButton
                    type="button"
                    size="xs"
                    variant="ghost"
                    className="agent-composer__reset"
                    disabled={!new_task_available}
                    onClick={props.on_reset}
                  >
                    <MessageSquarePlus aria-hidden="true" />
                    <span>{t("agent_page.action.new_task")}</span>
                  </AppButton>,
                )}
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={8}>
                <p>
                  {t("agent_page.shortcut_hint", {
                    action: t("agent_page.action.new_task"),
                    shortcut: get_shortcut_label("create"),
                  })}
                </p>
              </TooltipContent>
            </Tooltip>
          ) : null}
          {!inline ? (
            <AppDropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  {tooltip_trigger_target(
                    <AppDropdownMenuTrigger asChild>
                      <AppButton
                        type="button"
                        size="xs"
                        variant="ghost"
                        className="agent-composer__model-trigger"
                        disabled={model_controls_disabled}
                        aria-label={
                          context_usage === null
                            ? model_selection_aria_label
                            : `${model_selection_aria_label} · ${context_usage.percent}`
                        }
                      >
                        <Boxes aria-hidden="true" />
                        <span className="agent-composer__model-name">{selected_model_name}</span>
                        {context_usage !== null ? (
                          <>
                            <span
                              className="agent-composer__model-context-separator"
                              aria-hidden="true"
                            >
                              ·
                            </span>
                            <span
                              className="agent-composer__model-context"
                              data-tone={context_usage.tone}
                            >
                              {context_usage.percent}
                            </span>
                          </>
                        ) : null}
                        <ChevronDown aria-hidden="true" />
                      </AppButton>
                    </AppDropdownMenuTrigger>,
                  )}
                </TooltipTrigger>
                <TooltipContent
                  className="flex-col items-start gap-0.5 whitespace-nowrap"
                  side="top"
                  sideOffset={8}
                >
                  {context_usage !== null ? (
                    <p>{`${context_usage.used} / ${context_usage.total}`}</p>
                  ) : null}
                  {context_usage?.warning ? <p>{t("agent_page.context_usage_warning")}</p> : null}
                </TooltipContent>
              </Tooltip>
              <AppDropdownMenuContent align="start" matchTriggerWidth={false}>
                <ModelSelectionCategories
                  controller={props.model_selection}
                  usage="agent"
                  disabled={model_commands_disabled}
                />
              </AppDropdownMenuContent>
            </AppDropdownMenu>
          ) : null}
          {!inline && selected_thinking_label !== null && (
            <AppDropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex" tabIndex={thinking_unavailable ? 0 : undefined}>
                    <AppDropdownMenuTrigger asChild>
                      <AppButton
                        type="button"
                        size="xs"
                        variant="ghost"
                        className="agent-composer__thinking-trigger"
                        disabled={model_controls_disabled || thinking_unavailable}
                        aria-label={`${t("app.model.thinking_level.label")}: ${selected_thinking_label}`}
                      >
                        <Brain aria-hidden="true" />
                        <span>{selected_thinking_label}</span>
                        <ChevronDown aria-hidden="true" />
                      </AppButton>
                    </AppDropdownMenuTrigger>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={8}>
                  <p>
                    {thinking_unavailable
                      ? t("app.model.thinking_level.unsupported")
                      : t("app.model.thinking_level.label")}
                  </p>
                </TooltipContent>
              </Tooltip>
              <AppDropdownMenuContent align="start" matchTriggerWidth={false}>
                <ModelThinkingLevelOptions
                  controller={props.model_selection}
                  usage="agent"
                  disabled={model_commands_disabled}
                  on_thinking_level_change={props.on_thinking_level_change}
                />
              </AppDropdownMenuContent>
            </AppDropdownMenu>
          )}
          {!inline ? (
            <AppDropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  {tooltip_trigger_target(
                    <AppDropdownMenuTrigger asChild>
                      <AppButton
                        type="button"
                        size="xs"
                        variant="ghost"
                        className="agent-composer__approval-trigger"
                        data-approval-mode={approval_mode}
                        disabled={approval_mode_disabled}
                        aria-label={approval_mode_tooltip}
                      >
                        <ApprovalModeIcon
                          className="agent-composer__approval-icon"
                          aria-hidden="true"
                        />
                        <span className="agent-composer__approval-label">
                          {approval_mode_label}
                        </span>
                        <ChevronDown aria-hidden="true" />
                      </AppButton>
                    </AppDropdownMenuTrigger>,
                  )}
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={8}>
                  <p>{approval_mode_tooltip}</p>
                </TooltipContent>
              </Tooltip>
              <AppDropdownMenuContent align="end" matchTriggerWidth={false}>
                <AppDropdownMenuRadioGroup
                  value={approval_mode}
                  onValueChange={(value) => {
                    if (value === "manual" || value === "auto") {
                      props.on_approval_mode_change?.(value);
                    }
                  }}
                >
                  <AppDropdownMenuRadioItem value="manual">
                    <ShieldQuestionMark aria-hidden="true" />
                    {t("agent_page.approval.manual")}
                  </AppDropdownMenuRadioItem>
                  <AppDropdownMenuRadioItem value="auto">
                    <ShieldCheck aria-hidden="true" />
                    {t("agent_page.approval.auto")}
                  </AppDropdownMenuRadioItem>
                </AppDropdownMenuRadioGroup>
              </AppDropdownMenuContent>
            </AppDropdownMenu>
          ) : null}
          {!inline ? (
            <span className="agent-composer__hint">{t("agent_page.input.hint")}</span>
          ) : null}
        </div>
        <div className="agent-composer__footer-end">
          {inline ? (
            <>
              <AppButton
                type="button"
                size="sm"
                variant="outline"
                disabled={locked || props.command !== null}
                aria-label={t("app.action.cancel")}
                aria-keyshortcuts="Escape"
                onClick={props.on_cancel_edit}
              >
                {t("app.action.cancel")}
                <ShortcutKbd action="cancel" />
              </AppButton>
              <Tooltip>
                <TooltipTrigger asChild>
                  {tooltip_trigger_target(
                    <AppButton
                      className="agent-composer__inline-submit"
                      type="submit"
                      size="sm"
                      disabled={props.command !== null || !can_submit}
                      aria-label={contextual_submit_label}
                      aria-busy={submit_command_active || undefined}
                      aria-keyshortcuts="Enter"
                    >
                      {submit_command_active ? (
                        <LoaderCircle className="animate-spin" aria-hidden="true" />
                      ) : null}
                      <span>{contextual_submit_label}</span>
                      <ShortcutKbd
                        action="submit"
                        className="bg-background/18 text-primary-foreground"
                      />
                    </AppButton>,
                  )}
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={8}>
                  <p>
                    {t("agent_page.shortcut_hint", {
                      action: t("agent_page.input.newline"),
                      shortcut: get_shortcut_label("newline"),
                    })}
                  </p>
                </TooltipContent>
              </Tooltip>
            </>
          ) : (
            <Tooltip>
              {/* 外层触发器在按钮禁用 pointer events 时仍可承接悬停。 */}
              <TooltipTrigger asChild>
                <span className="agent-composer__submit-shell">
                  <AppButton
                    className="agent-composer__submit"
                    type={stopping ? "button" : "submit"}
                    size="icon-xs"
                    onClick={
                      stopping && !props.stop_disabled && !compacting && props.command === null
                        ? () => void props.on_stop()
                        : undefined
                    }
                    disabled={
                      props.command !== null ||
                      (stopping ? props.stop_disabled || compacting : !can_submit)
                    }
                    aria-label={contextual_submit_label}
                    aria-busy={submit_command_active || undefined}
                  >
                    {(compacting && stopping) || submit_command_active ? (
                      <LoaderCircle className="animate-spin" aria-hidden="true" />
                    ) : stopping ? (
                      <Square aria-hidden="true" />
                    ) : (
                      <Send aria-hidden="true" />
                    )}
                  </AppButton>
                </span>
              </TooltipTrigger>
              {submit_command_active ? null : (
                <TooltipContent side="top" sideOffset={8}>
                  <p>
                    {props.unavailable_reason === null
                      ? contextual_submit_label
                      : t(AGENT_UNAVAILABLE_REASON_KEYS[props.unavailable_reason])}
                  </p>
                </TooltipContent>
              )}
            </Tooltip>
          )}
        </div>
      </div>
    </form>
  );

  /** 两个分组共用连续 option 索引，使键盘导航与 aria-activedescendant 指向同一项。 */
  function render_candidate(candidate: AgentMentionCandidate, index: number): JSX.Element {
    const Icon = candidate.kind === "skill" ? Sparkles : BookA;
    return (
      <button
        id={`agent-mention-option-${index.toString()}`}
        key={candidate.key}
        type="button"
        role="option"
        aria-selected={index === menu_index}
        data-highlight={index === menu_index}
        tabIndex={-1}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => select_candidate(candidate)}
      >
        <Icon aria-hidden="true" />
        <strong>{candidate.title}</strong>
        {candidate.description !== "" && <small>{candidate.description}</small>}
      </button>
    );
  }

  /** 菜单有候选时循环选择；零结果时把方向键交还 CodeMirror。 */
  function navigate_mention_menu(delta: 1 | -1): boolean {
    if (!menu_open_ref.current || matching_candidates_ref.current.length === 0) return false;
    set_menu_index(
      (current) =>
        (current + delta + matching_candidates_ref.current.length) %
        matching_candidates_ref.current.length,
    );
    return true;
  }

  /** 仅从视觉首行进入历史；越过最新消息时恢复原始草稿，两端都消费按键。 */
  function navigate_input_history(view: EditorView, direction: "older" | "newer"): boolean {
    const input_history = input_session_ref.current.read_history();
    if (view.composing || view.state.readOnly) return false;
    const current_index = input_history_index_ref.current;

    if (current_index === null) {
      if (direction === "newer" || input_history.length === 0 || !can_start_input_history(view)) {
        return false;
      }
      const next_index = input_history.length - 1;
      input_history_index_ref.current = next_index;
      write_agent_message_text(
        view,
        input_history[next_index]!,
        input_history_navigation_annotations,
      );
      return true;
    }

    const next_index = current_index + (direction === "older" ? -1 : 1);
    if (next_index < 0) return true;
    if (next_index >= input_history.length) {
      input_history_index_ref.current = null;
      write_agent_message_text(
        view,
        input_session_ref.current.read_draft().text,
        input_history_navigation_annotations,
      );
      return true;
    }
    input_history_index_ref.current = next_index;
    write_agent_message_text(
      view,
      input_history[next_index]!,
      input_history_navigation_annotations,
    );
    return true;
  }
}

/** 视觉顶部由 CodeMirror 判断，原生覆盖软换行。 */
function can_start_input_history(view: EditorView): boolean {
  const selection = view.state.selection;
  if (selection.ranges.length !== 1 || !selection.main.empty) return false;
  return view.moveToLineBoundary(selection.main, false, true).head === 0;
}

/** 用单次事务同步纯文本正文与末尾光标。 */
function write_agent_message_text(
  view: EditorView,
  text: string,
  annotations?: TransactionSpec["annotations"],
): void {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    selection: EditorSelection.cursor(text.length),
    annotations,
  });
}

/** 一次生成上下文百分比、详情与色阶，避免组件分别重复派生。 */
function format_context_usage(usage: {
  tokens: number;
  contextWindow: number;
  maxTokens: number;
}): {
  percent: string;
  used: string;
  total: string;
  tone: "default" | "warning";
  warning: boolean;
} {
  const percent = (usage.tokens / usage.contextWindow) * 100;
  // 预警到自动压缩之间保留一份最大输出预算。
  const warning =
    usage.tokens >= usage.contextWindow - usage.maxTokens - AGENT_COMPACTION_RESERVE_TOKENS;
  return {
    percent: `${percent.toFixed(1)}%`,
    used: format_context_tokens(usage.tokens),
    total: format_context_tokens(usage.contextWindow),
    tone: warning ? "warning" : "default",
    warning,
  };
}

/** 鼠标提示中的上下文详情固定以整数 K 展示。 */
function format_context_tokens(tokens: number): string {
  return `${Math.round(tokens / 1_000).toString()}K`;
}

/** 单次读取编辑器派生视图，避免 React 再维护一份可写草稿事实。 */
function read_editor_snapshot(state: EditorState): EditorSnapshot {
  return {
    text: state.doc.toString().trim(),
    query: find_mention_query(state),
  };
}

/** 只把光标前当前单词视为查询，不扫描整篇正文。 */
function find_mention_query(state: EditorState): MentionQuery | null {
  const selection = state.selection.main;
  if (!selection.empty) return null;
  const line = state.doc.lineAt(selection.head);
  const before = state.doc.sliceString(line.from, selection.head);
  const match = before.match(/(^|\s)@([^\s@]*)$/u);
  if (match === null) return null;
  const from = selection.head - match[0].length + match[1].length;
  const token = state.field(mention_tokens_field).iter(from);
  if (token.value !== null && token.from < selection.head && token.to > from) return null;
  return { from, to: selection.head, text: match[2] ?? "" };
}

/** 把已知 marker 投影成原子视觉块，底层文档仍保留完整稳定协议。 */
function create_mention_token_decorations(
  text: string,
  tokens: readonly AgentMentionToken[],
): DecorationSet {
  return Decoration.set(
    find_agent_mention_ranges(text, tokens).map((range) =>
      Decoration.replace({
        widget: new MentionTokenWidget(range.marker),
        inclusive: false,
      }).range(range.from, range.to),
    ),
    true,
  );
}

/** 输入框中的 mention 视觉块；光标只能停在完整 marker 两侧。 */
class MentionTokenWidget extends WidgetType {
  private static readonly CURSOR_GAP_PX = 1;
  private readonly marker: string;

  /** marker 既是显示文本，也是底层纯文本协议的原始值。 */
  public constructor(marker: string) {
    super();
    this.marker = marker;
  }

  /** 相同 marker 复用既有 DOM，避免普通编辑事务造成视觉闪动。 */
  public override eq(widget: WidgetType): boolean {
    return widget instanceof MentionTokenWidget && widget.marker === this.marker;
  }

  /** 创建与时间线共用样式的紧凑块。 */
  public override toDOM(): HTMLElement {
    const token = document.createElement("span");
    const text = document.createElement("span");
    token.className = "agent-mention-token";
    text.textContent = this.marker;
    token.append(text);
    return token;
  }

  /** 把 marker 两侧文档位置映射到视觉块边界。 */
  public override coordsAt(dom: HTMLElement, pos: number) {
    const rect = dom.getBoundingClientRect();
    const x = pos === 0 ? rect.left : rect.right + MentionTokenWidget.CURSOR_GAP_PX;
    return { left: x, right: x, top: rect.top, bottom: rect.bottom };
  }
}
