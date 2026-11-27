import {
  find_agent_reference_ranges,
  format_agent_reference,
  format_agent_reference_parts,
  resolve_agent_reference_labels,
  type AgentReferenceRange,
} from "@shared/agent-reference";
import { resolve_raster_image_extension } from "@shared/image-formats";
import {
  normalize_source_paths,
  read_file_path,
  read_file_paths,
} from "@frontend/app/desktop/source-paths";
import { push_toast } from "@frontend/app/feedback/desktop-toast";
import { useAgentMentionFiles } from "./use-agent-mention-files";
import {
  type JSX,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useSyncExternalStore,
  type Ref,
  type RefObject,
  type ReactNode,
} from "react";
import { FileText, Paperclip, Sparkles, SquareSlash } from "lucide-react";

import { defaultKeymap, history, historyKeymap, isolateHistory } from "@codemirror/commands";
import {
  Annotation,
  Compartment,
  EditorSelection,
  EditorState,
  StateField,
  Transaction,
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

import {
  AGENT_MESSAGE_IMAGE_LIMIT,
  type AgentMessageInput,
  type AgentResponseAnnotationAttachment,
  type AgentSkillSnapshot,
} from "@shared/agent";
import { useAppearance } from "@frontend/app/appearance/appearance-context";
import { useI18n } from "@frontend/app/locale/locale-context";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipTarget } from "@frontend/shadcn/tooltip";
import { AppButton } from "@frontend/widgets/app-button";
import {
  create_app_editor_text_hover_extension,
  resolve_app_editor_readonly_extensions,
  resolve_app_editor_theme_extensions,
} from "@frontend/widgets/app-editor/app-editor-code-mirror";
import type { AgentInputState } from "@frontend/app/session/agent/agent-chat-context";
import {
  create_agent_mention_candidates,
  type AgentMentionCandidate,
  type AgentMentionInstruction,
} from "./agent-mention";
import type { AgentDraftAttachment } from "@frontend/app/session/agent/agent-input-draft";
import { AgentMessageAttachments } from "./agent-message-attachments";
import { FileDropTarget } from "@frontend/widgets/interactions/file-drop-target";
import {
  AppDropdownMenu,
  AppDropdownMenuContent,
  AppDropdownMenuItem,
  AppDropdownMenuTrigger,
} from "@frontend/widgets/app-dropdown-menu";
import {
  resolve_agent_reference_file,
  useAgentCopyText,
  useAgentFileAction,
  type AgentFileTarget,
} from "./use-agent-file-action";

/** 光标前当前 @ 查询范围。 */
type MentionQuery = {
  from: number;
  to: number;
  text: string;
};

/** 指令入口代写的查询前缀。`at` 记录其中 `@` 的位置。 */
type InstructionTrigger = Readonly<{ from: number; at: number; text: string }>;

/** 页面动作通过编辑器事务同步草稿，选区与焦点由 CodeMirror 管理。 */
export type AgentMessageEditorHandle = {
  append_draft: (text: string, selection?: Readonly<{ from: number; to: number }>) => boolean;
  add_response_annotation: (annotation: AgentResponseAnnotationAttachment) => void;
  insert_files: (files: readonly File[]) => void;
  insert_file_references: (paths: readonly string[]) => void;
  focus: () => void;
};

type AgentEditorState = { has_content: boolean; uploads_pending: boolean };

type AgentMessageEditorProps = {
  ref?: Ref<AgentMessageEditorHandle> | undefined;
  page_handles_file_drop?: boolean; // 主对话在整页接收文件，原位编辑在输入区接收。
  presentation?: "composer" | "inline" | undefined;
  role?: "user" | "assistant" | undefined;
  read_only: boolean;
  placeholder?: string | undefined; // 主输入由页面提供工程提示，原位编辑沿用角色文案。
  skills: readonly AgentSkillSnapshot[];
  instructions?: readonly AgentMentionInstruction[] | undefined;
  input_state: AgentInputState;
  on_submit: (message: AgentMessageInput) => void;
  on_cancel?: (() => void) | undefined;
  /** 编辑器提供文件与指令入口，消费方统一排列动作并决定提交权限。 */
  render_actions: (
    state: AgentEditorState,
    add_file: ReactNode,
    open_instructions: ReactNode,
  ) => {
    can_submit: boolean;
    actions: ReactNode;
    submit: ReactNode;
  };
};

/** 历史导航保留浏览位置，正文变化始终交给共享草稿。 */
const input_history_navigation_annotation = Annotation.define<boolean>();
const input_history_navigation_annotations = [
  Transaction.addToHistory.of(false),
  input_history_navigation_annotation.of(true),
];
/** 草稿回填沿用当前事实，并退出 CodeMirror 的撤销记录。 */
const input_state_sync_annotations = [Transaction.addToHistory.of(false)];

// 三个 Compartment 只承接运行期配置，不参与草稿事实。
const theme_compartment = new Compartment();
const read_only_compartment = new Compartment();
const placeholder_compartment = new Compartment();
const mention_file_nodes = new WeakMap<HTMLElement, AgentFileTarget>(); // 点击只读挂载在块上的文件目标。
const FILE_CLICK_MAX_DISTANCE_PX = 4; // 区分点击和从文件块开始的拖选。

// 引用块只依赖正文，技能列表仅影响候选菜单。
const mention_tokens_field = StateField.define<DecorationSet>({
  create: (state) => create_mention_token_decorations(state.doc.toString()),
  update(tokens, transaction) {
    return transaction.docChanged
      ? create_mention_token_decorations(transaction.newDoc.toString())
      : tokens;
  },
  /** 绘制与光标导航共用引用块范围。 */
  provide(field) {
    return [
      EditorView.decorations.from(field),
      EditorView.atomicRanges.of((view) => view.state.field(field)),
    ];
  },
});

/** 主输入与原位编辑共享正文、附件和键盘交互，按草稿 revision 同步 CodeMirror。 */
export function AgentMessageEditor(props: AgentMessageEditorProps): JSX.Element {
  const { locale, t } = useI18n();
  const { resolved_theme } = useAppearance();
  const inline = props.presentation === "inline";
  const assistant_editing = props.role === "assistant";
  const placeholder_text =
    props.placeholder ??
    t(
      assistant_editing
        ? "agent_page.input.edit_assistant_placeholder"
        : "agent_page.input.placeholder",
    );
  const host_ref = useRef<HTMLDivElement | null>(null);
  const form_ref = useRef<HTMLFormElement | null>(null);
  const file_input_ref = useRef<HTMLInputElement | null>(null);
  const menu_ref = useRef<HTMLDivElement | null>(null);
  const view_ref = useRef<EditorView | null>(null);
  const retained_editor = useRef<{ state: EditorState; focused: boolean } | null>(null); // React 重连编辑器时恢复选区、撤销历史与焦点。
  const submit_ref = useRef<() => void>(() => undefined);
  // CodeMirror 扩展只创建一次，ref 保证 Escape 调用最新的页面取消入口。
  const cancel_edit_ref = useRef(props.on_cancel);
  const select_candidate_ref = useRef<(candidate: AgentMentionCandidate) => void>(() => undefined);
  const menu_open_ref = useRef(false);
  const matching_candidates_ref = useRef<readonly AgentMentionCandidate[]>([]);
  const menu_index_ref = useRef(0);
  const last_query_key_ref = useRef("");
  const instruction_trigger_ref = useRef<InstructionTrigger | null>(null); // 用户尚未接管的代写 @
  // 草稿拥有当前可见正文，历史浏览只缓存列表与原正文，附件继续属于草稿。
  const input_state_ref = useRef(props.input_state);
  const input_history_navigation_ref = useRef<{
    texts: readonly string[]; // 本次浏览沿用固定顺序，回执更新历史时继续使用
    index: number;
    original_text: string; // 只恢复正文，附件保留当前上传与编辑结果
  } | null>(null);
  const draft = useSyncExternalStore(
    props.input_state.draft.subscribe,
    props.input_state.draft.read,
  );
  const draft_attachments = draft.attachments;
  const [mention_query, set_mention_query] = useState<MentionQuery | null>(null);
  const uploads_pending = draft_attachments.some((attachment) => attachment.kind === "upload");
  const [menu_index_value, set_menu_index] = useState(0);
  const [menu_suppressed, set_menu_suppressed] = useState(false);
  const [file_menu, set_file_menu] = useState<{
    x: number;
    y: number;
    target: AgentFileTarget;
  } | null>(null);
  const file_action = useAgentFileAction();
  const copy_file_path = useAgentCopyText();
  const file_action_ref = useRef(file_action);
  file_action_ref.current = file_action; // 现有 CodeMirror 实例读取最新工程上下文。

  const mention_query_text = mention_query?.text;
  const file_query = useAgentMentionFiles(
    !assistant_editing && mention_query_text !== undefined && !props.read_only && !menu_suppressed,
    draft_attachments
      .filter((file) => file.kind === "file")
      .map((file) => file.uploadId)
      .join("|"),
  );
  const candidate_groups =
    assistant_editing || mention_query_text === undefined
      ? { skills: [], files: [], instructions: [] }
      : create_agent_mention_candidates({
          query: mention_query_text,
          locale,
          skills: props.skills,
          files: file_query.files,
          instructions: props.instructions ?? [],
        });
  const menu_groups = ["skills", "instructions", "files"] as const; // 渲染与键盘导航共用顺序。
  const matching_candidates = menu_groups.flatMap((group) => candidate_groups[group]);
  const instruction_start = matching_candidates.findIndex(
    (candidate) => candidate.kind === "instruction",
  );
  const editor_read_only = props.read_only;
  useAgentComposerHighlight(form_ref, !inline && !editor_read_only);
  const menu_open =
    !assistant_editing && mention_query !== null && !editor_read_only && !menu_suppressed;
  const menu_index = Math.max(0, Math.min(menu_index_value, matching_candidates.length - 1));
  const has_sendable_content =
    draft.text.trim() !== "" || (!assistant_editing && draft_attachments.length > 0);
  const can_append_files = !editor_read_only && !assistant_editing;
  const actions = props.render_actions(
    { has_content: has_sendable_content, uploads_pending },
    !assistant_editing ? (
      <AppButton
        type="button"
        size="sm"
        variant="ghost"
        className="agent-composer__file-trigger"
        disabled={!can_append_files}
        onClick={() => file_input_ref.current?.click()}
      >
        <Paperclip aria-hidden="true" />
        <span>{t("agent_page.action.add_file")}</span>
      </AppButton>
    ) : null,
    !assistant_editing && props.instructions !== undefined ? (
      <AppButton
        type="button"
        size="sm"
        variant="ghost"
        className="agent-composer__instructions-trigger"
        disabled={editor_read_only}
        onClick={open_instruction_menu}
      >
        <SquareSlash aria-hidden="true" />
        <span>{t("agent_page.action.common_instructions")}</span>
      </AppButton>
    ) : null,
  );
  // 编辑器只创建一次，首次锁定态必须在首帧扩展中生效，不能等待后续 effect。
  const initial_editor_read_only_ref = useRef(editor_read_only);
  const input_revision = props.input_state.revision;

  menu_open_ref.current = menu_open;
  matching_candidates_ref.current = matching_candidates;
  menu_index_ref.current = menu_index;
  input_state_ref.current = props.input_state;
  cancel_edit_ref.current = editor_read_only ? undefined : props.on_cancel;

  useEffect(() => {
    const host = host_ref.current;
    if (host === null) return;
    let file_press: { node: HTMLElement; x: number; y: number } | null = null;
    // 光标查询变化才更新候选菜单，正文与附件直接订阅共享草稿。
    const update_mention_query = (state: EditorState): void => {
      const query = find_mention_query(state);
      const query_key =
        query === null ? "" : `${query.from.toString()}:${query.to.toString()}:${query.text}`;
      if (query_key !== last_query_key_ref.current) {
        last_query_key_ref.current = query_key;
        set_menu_index(0);
        set_menu_suppressed(false);
        set_mention_query(query);
      }
    };
    const editor = new EditorView({
      parent: host,
      state:
        retained_editor.current?.state ??
        EditorState.create({
          extensions: [
            theme_compartment.of(resolve_app_editor_theme_extensions(resolved_theme, "plain")),
            read_only_compartment.of(
              resolve_app_editor_readonly_extensions(initial_editor_read_only_ref.current),
            ),
            placeholder_compartment.of(placeholder(placeholder_text)),
            mention_tokens_field,
            create_app_editor_text_hover_extension(read_mention_hover, { hideOnChange: true }),
            drawSelection(),
            history(),
            EditorView.lineWrapping,
            EditorView.domEventHandlers({
              blur: () => set_menu_suppressed(true),
              keydown: (event) => event.key === "Enter" && event.isComposing,
              mousedown: (event) => {
                const node = find_mention_file_node(event);
                file_press =
                  event.button === 0 && node !== null
                    ? { node, x: event.clientX, y: event.clientY }
                    : null;
                return false; // 让 CodeMirror 照常处理光标和拖选。
              },
              click: (event, view) => {
                const press = file_press;
                file_press = null;
                if (
                  event.button !== 0 ||
                  press === null ||
                  press.node !== find_mention_file_node(event) ||
                  !view.state.selection.main.empty ||
                  Math.hypot(event.clientX - press.x, event.clientY - press.y) >
                    FILE_CLICK_MAX_DISTANCE_PX
                )
                  return false;
                const target = mention_file_nodes.get(press.node);
                if (target === undefined || !file_action_ref.current.can_open(target)) return false;
                void file_action_ref.current.run(target);
                return true;
              },
              contextmenu: (event, view) => {
                const node = find_mention_file_node(event);
                // 选区的编辑命令由 Electron 原生菜单承接。
                if (node === null || !view.state.selection.main.empty) return false;
                const target = mention_file_nodes.get(node);
                if (target === undefined || !file_action_ref.current.can_open(target)) return false;
                set_file_menu({ x: event.clientX, y: event.clientY, target });
                return true;
              },
              // 跳过 CodeMirror 的文件读取，让事件冒泡到所在区域的 FileDropTarget。
              drop: (event) => event.dataTransfer?.types.includes("Files") ?? false,
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
                  const cancel_edit = cancel_edit_ref.current;
                  if (!inline || cancel_edit === undefined) return false;
                  cancel_edit();
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
              const { docChanged, selectionSet, state, transactions } = update;
              if (docChanged || selectionSet) {
                if (docChanged) {
                  const from_history = transactions.every(
                    (transaction) =>
                      transaction.annotation(input_history_navigation_annotation) === true,
                  );
                  if (!from_history) input_history_navigation_ref.current = null;
                  const draft = input_state_ref.current.draft;
                  const current = draft.read();
                  const text = state.doc.toString();
                  // 正文相同就沿用共享草稿，回填与相同文本替换不会产生回流。
                  if (current.text !== text) draft.write({ ...current, text });
                }
                update_mention_query(state);
              }
            }),
          ],
        }),
    });
    editor.contentDOM.setAttribute("aria-label", placeholder_text);
    editor.contentDOM.setAttribute("aria-multiline", "true");
    editor.contentDOM.setAttribute("spellcheck", "false");
    view_ref.current = editor;
    if (retained_editor.current?.focused) editor.focus();
    update_mention_query(editor.state);
    return () => {
      retained_editor.current = { state: editor.state, focused: editor.hasFocus };
      editor.destroy();
      view_ref.current = null;
    };
  }, []);

  useEffect(() => {
    const view = view_ref.current;
    if (view === null) return;
    const current = input_state_ref.current.draft.read();
    if (view.state.doc.toString() === current.text) return;
    write_agent_message_text(view, current.text, input_state_sync_annotations);
  }, [props.input_state, input_revision, draft.text]);

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

  /** `aria-activedescendant` 不移动焦点，键盘活动项需要显式滚入视野。 */
  const scroll_mention_candidate_into_view = useCallback((index: number): void => {
    menu_ref.current
      ?.querySelector<HTMLElement>(`#agent-mention-option-${index.toString()}`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, []);

  useEffect(() => {
    if (menu_open) scroll_mention_candidate_into_view(menu_index_ref.current);
  }, [mention_query_text, menu_open, scroll_mention_candidate_into_view]);

  // 指令入口代写的 @ 只在菜单打开期间暂存：用户输入筛选后转为普通正文，未输入即关闭则撤回。
  useEffect(() => {
    const trigger = instruction_trigger_ref.current;
    const view = view_ref.current;
    if (trigger === null || view === null) return;
    if (menu_open && mention_query?.from === trigger.at) {
      if (mention_query.text !== "") instruction_trigger_ref.current = null;
      else if (instruction_start >= 0) {
        set_menu_index(instruction_start);
        menu_ref.current
          ?.querySelector('[aria-labelledby="agent-mention-instructions-label"]')
          ?.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
      return;
    }
    instruction_trigger_ref.current = null;
    const to = trigger.from + trigger.text.length;
    if (view.state.sliceDoc(trigger.from, to) !== trigger.text) return;
    view.dispatch({
      changes: { from: trigger.from, to },
      annotations: Transaction.addToHistory.of(false),
    });
  }, [instruction_start, mention_query, menu_open]);

  /** 引用写入正文。指令移除查询后立即执行。 */
  const select_candidate = (candidate: AgentMentionCandidate): void => {
    const view = view_ref.current;
    const query = view === null ? null : find_mention_query(view.state);
    if (view === null || query === null) return;
    if (candidate.kind === "instruction" && candidate.disabled) return;
    const trigger = instruction_trigger_ref.current;
    instruction_trigger_ref.current = null; // 选中后的正文由候选自身决定，不再撤回入口代写的 @
    if (candidate.kind === "instruction") {
      // 入口补写的前导空格随筛选文本一并移除，正文恢复原样。
      const from = trigger?.at === query.from ? trigger.from : query.from;
      view.dispatch({
        changes: { from, to: query.to, insert: "" },
        selection: EditorSelection.cursor(from),
      });
      set_menu_suppressed(false);
      candidate.execute();
      view.focus();
      return;
    }
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
  const write_draft_attachments = useCallback((attachments: AgentDraftAttachment[]): void => {
    const draft = input_state_ref.current.draft;
    draft.write({ ...draft.read(), attachments });
  }, []);

  /** 一次事务替换选区，文件块可与普通正文并排。 */
  const insert_file_references = (paths: readonly string[]): void => {
    const view = view_ref.current;
    if (!can_append_files || view === null || paths.length === 0) return;
    const { from, to } = view.state.selection.main;
    const before = from > 0 && !/\s/u.test(view.state.sliceDoc(from - 1, from)) ? " " : "";
    const after = /\s/u.test(view.state.sliceDoc(to, to + 1)) ? "" : " ";
    const markers = paths.map((path) => format_agent_reference({ kind: "file", path }));
    const text = before + markers.join(" ") + after;
    view.dispatch({
      changes: { from, to, insert: text },
      selection: EditorSelection.cursor(from + text.length),
    });
    view.focus();
  };

  /** 超限批次的本机图片保留原始目录，虚拟图片继续作为附件。 */
  const insert_files = (files: Iterable<File>): void => {
    if (!can_append_files || view_ref.current === null) return;
    let images: File[] = [];
    const other_files: File[] = [];
    for (const file of files) {
      (resolve_raster_image_extension(file.name) === null ? other_files : images).push(file);
    }
    // 从权威草稿读取，连续输入在 React 重绘前也会计入上传占位。
    const existing_image_count = props.input_state.draft.read().attachments.filter((attachment) => {
      if (attachment.kind === "file") return attachment.imageMimeType !== null;
      return (
        (attachment.kind === "staged_file" || attachment.kind === "upload") &&
        resolve_raster_image_extension(attachment.name) !== null
      );
    }).length;
    const { paths, skipped } = read_file_paths(other_files);
    if (existing_image_count + images.length > AGENT_MESSAGE_IMAGE_LIMIT) {
      images = images.filter((image) => {
        const path = read_file_path(image);
        if (path === null) return true;
        paths.push(path);
        return false;
      });
    }
    insert_file_references(normalize_source_paths(paths));
    if (images.length > 0) void props.input_state.draft.append(images);
    if (skipped.length > 0)
      push_toast("warning", t("agent_page.error.invalid_file_path"), {
        description: skipped.join("\n"),
      });
  };

  /** 按混合附件列表的原始索引删除，并同步权威草稿。 */
  const remove_attachment = (index: number): void => {
    write_draft_attachments(
      input_state_ref.current.draft
        .read()
        .attachments.filter((_, attachment_index) => attachment_index !== index),
    );
  };

  /** 附件组件只提交用户意图，Composer 仍在当前权威草稿中按原索引写入。 */
  const update_annotation = (index: number, comment: string): void => {
    const current = input_state_ref.current.draft.read().attachments;
    const annotation = current[index];
    if (annotation?.kind !== "response_annotation") return;
    write_draft_attachments(
      current.map((attachment, attachment_index) =>
        attachment_index === index ? { ...annotation, comment } : attachment,
      ),
    );
  };

  useImperativeHandle(props.ref, () => ({
    insert_files,
    insert_file_references,
    /** 预置指令只追加正文。编辑锁阻止写入时返回 `false`，供解锁后重试。 */
    append_draft(text, selection) {
      const view = view_ref.current;
      if (view === null || editor_read_only) return false;
      const base = view.state.doc.toString().trim();
      const offset = base === "" ? 0 : base.length + 1; // 请求选区相对预置正文，需加上已有正文与换行的长度。
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: base === "" ? text : `${base}\n${text}`,
        },
        selection: selection
          ? EditorSelection.range(offset + selection.from, offset + selection.to)
          : EditorSelection.cursor(offset + text.length),
        scrollIntoView: true, // 长草稿追加后将新内容带入可视区。
        annotations: isolateHistory.of("full"), // 预置指令单独撤销，避免连带撤销前后输入。
      });
      view.focus();
      return true;
    },
    /** 复制批注后加入当前草稿，助手历史编辑遵循纯正文边界。 */
    add_response_annotation(annotation) {
      if (editor_read_only || assistant_editing) return;
      write_draft_attachments([
        ...input_state_ref.current.draft.read().attachments,
        structuredClone(annotation),
      ]);
      view_ref.current?.focus();
    },
    /** 页面动作完成后将焦点交回当前编辑器。 */
    focus() {
      view_ref.current?.focus();
    },
  }));

  /** 编辑器提交当前草稿。`AgentChatStore` 在受理后原子更新历史与草稿。 */
  const submit = (): void => {
    const view = view_ref.current;
    if (view === null || !actions.can_submit) return;
    const draft = input_state_ref.current.draft.read();
    if (draft.attachments.some((attachment) => attachment.kind === "upload")) return;
    props.on_submit({
      text: draft.text.trim(),
      attachments: draft.attachments.filter(
        (attachment) => attachment.kind !== "upload" && attachment.kind !== "staged_file",
      ),
    });
  };
  submit_ref.current = submit;

  return (
    <form
      ref={form_ref}
      className={`agent-operation-surface agent-composer${inline ? " agent-composer--inline" : ""}`}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      onPaste={(event) => {
        if (event.clipboardData.files.length === 0) return;
        event.preventDefault();
        insert_files(event.clipboardData.files);
      }}
    >
      {props.page_handles_file_drop ? null : (
        <FileDropTarget
          label={t("app.drop.release")}
          target_ref={form_ref}
          enabled={can_append_files}
          on_files={insert_files}
        />
      )}
      {menu_open && (
        <div ref={menu_ref} id="agent-mention-menu" className="agent-mention-menu" role="listbox">
          {menu_groups.map((group) => {
            const candidates = candidate_groups[group];
            const file_status = group === "files" ? file_query.status : null;
            if (candidates.length === 0 && file_status !== "loading" && file_status !== "error")
              return null;
            const start = matching_candidates.findIndex((candidate) => candidate === candidates[0]); // 空组没有候选，不消费索引。
            const label_id = `agent-mention-${group}-label`;
            return (
              <div
                key={group}
                className="agent-mention-menu__group"
                role="group"
                aria-labelledby={label_id}
              >
                <div id={label_id} className="agent-mention-menu__group-label">
                  {t(`agent_page.mention.groups.${group}`)}
                </div>
                {candidates.map((candidate, index) => render_candidate(candidate, start + index))}
                {(file_status === "loading" || file_status === "error") && (
                  <p className="agent-mention-menu__empty">
                    {t(`agent_page.mention.files.${file_status}`)}
                  </p>
                )}
              </div>
            );
          })}
          {matching_candidates.length === 0 &&
            file_query.status !== "loading" &&
            file_query.status !== "error" && (
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
          disabled={editor_read_only}
          on_update_annotation={update_annotation}
          on_remove={remove_attachment}
          on_retry={(id) => props.input_state.draft.retry(id)}
        />
      ) : null}
      <div className="agent-composer__editor">
        <div ref={host_ref} className="agent-composer__input" />
      </div>
      <AppDropdownMenu
        open={file_menu !== null}
        onOpenChange={(open) => {
          if (!open) set_file_menu(null);
        }}
      >
        <AppDropdownMenuTrigger
          render={<span />}
          nativeButton={false}
          aria-hidden
          tabIndex={-1}
          className="agent-composer__file-menu-anchor"
          style={{ left: file_menu?.x, top: file_menu?.y }}
        />
        {file_menu !== null ? (
          <AppDropdownMenuContent
            align="start"
            matchTriggerWidth={false}
            finalFocus={() => view_ref.current?.contentDOM}
          >
            {file_action.menu_items(file_menu.target).map(({ label, run }) => (
              <AppDropdownMenuItem key={label} onClick={run}>
                {t(label)}
              </AppDropdownMenuItem>
            ))}
            <AppDropdownMenuItem
              onClick={() =>
                void copy_file_path(file_menu.target.source?.path ?? file_menu.target.path)
              }
            >
              {t("agent_page.link.copy")}
            </AppDropdownMenuItem>
          </AppDropdownMenuContent>
        ) : null}
      </AppDropdownMenu>
      <input
        ref={file_input_ref}
        className="agent-composer__file-input"
        type="file"
        multiple
        tabIndex={-1}
        onChange={(event) => {
          insert_files(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
        }}
      />
      <div className="agent-composer__footer">
        <div className="agent-composer__footer-actions">{actions.actions}</div>
        <div className="agent-composer__footer-end">{actions.submit}</div>
      </div>
    </form>
  );

  /** 所有分组共用连续 option 索引，使键盘导航与 aria-activedescendant 指向同一项。 */
  function render_candidate(candidate: AgentMentionCandidate, index: number): JSX.Element {
    const Icon =
      candidate.kind === "instruction"
        ? candidate.icon
        : candidate.kind === "skill"
          ? Sparkles
          : FileText;
    const disabled = candidate.kind === "instruction" && candidate.disabled;
    return (
      <Tooltip key={candidate.key}>
        <TooltipTrigger
          tabIndex={-1}
          onMouseDown={(event) => event.preventDefault()}
          onMouseMove={() => {
            if (!disabled) set_menu_index(index);
          }}
          render={
            // 整行外壳同时承接禁用项悬停与定位，避免箭头贴入文本区域。
            <TooltipTarget className="agent-mention-menu__row">
              <button
                id={`agent-mention-option-${index.toString()}`}
                type="button"
                role="option"
                aria-selected={index === menu_index}
                disabled={disabled}
                data-kind={candidate.kind}
                tabIndex={-1}
                onClick={() => select_candidate(candidate)}
              >
                <Icon aria-hidden="true" />
                <strong>{candidate.title}</strong>
                <small>{candidate.description}</small>
              </button>
            </TooltipTarget>
          }
        />
        <TooltipContent>
          <div className="agent-mention-menu__tooltip">
            <strong>{candidate.title}</strong>
            {candidate.description !== "" && <p>{candidate.description}</p>}
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }

  /** 在光标处代写 @ 打开菜单，正则要求 @ 前为空白，必要时补一个空格。 */
  function open_instruction_menu(): void {
    const view = view_ref.current;
    if (view === null) return;
    const head = view.state.selection.main.head;
    const text = /^\s?$/u.test(view.state.sliceDoc(Math.max(0, head - 1), head)) ? "@" : " @";
    instruction_trigger_ref.current = { from: head, at: head + text.length - 1, text };
    view.dispatch({
      changes: { from: head, insert: text },
      selection: EditorSelection.cursor(head + text.length),
      annotations: Transaction.addToHistory.of(false),
    });
    view.focus();
  }

  /** 菜单有候选时循环选择。零结果时把方向键交还 CodeMirror。 */
  function navigate_mention_menu(delta: 1 | -1): boolean {
    if (!menu_open_ref.current || matching_candidates_ref.current.length === 0) return false;
    const next_index =
      (menu_index_ref.current + delta + matching_candidates_ref.current.length) %
      matching_candidates_ref.current.length;
    set_menu_index(next_index);
    // 键盘活动项需要显式滚入视野。鼠标接管活动项时保持菜单位置。
    scroll_mention_candidate_into_view(next_index);
    return true;
  }

  /** 历史导航从视觉首行进入。越过最新消息时恢复原始草稿。 */
  function navigate_input_history(view: EditorView, direction: "older" | "newer"): boolean {
    if (view.composing || view.state.readOnly) return false;
    const navigation = input_history_navigation_ref.current;

    if (navigation === null) {
      const input_history = input_state_ref.current.read_history();
      if (direction === "newer" || input_history.length === 0 || !can_start_input_history(view)) {
        return false;
      }
      const next_index = input_history.length - 1;
      input_history_navigation_ref.current = {
        texts: input_history,
        index: next_index,
        original_text: input_state_ref.current.draft.read().text,
      };
      write_agent_message_text(
        view,
        input_history[next_index]!,
        input_history_navigation_annotations,
      );
      return true;
    }

    const next_index = navigation.index + (direction === "older" ? -1 : 1);
    if (next_index < 0) return true;
    if (next_index >= navigation.texts.length) {
      input_history_navigation_ref.current = null;
      write_agent_message_text(
        view,
        navigation.original_text,
        input_history_navigation_annotations,
      );
      return true;
    }
    navigation.index = next_index;
    write_agent_message_text(
      view,
      navigation.texts[next_index]!,
      input_history_navigation_annotations,
    );
    return true;
  }
}

const COMPOSER_HIGHLIGHT_POSITION = "--agent-composer-highlight-position";
const COMPOSER_HIGHLIGHT_DISABLED = "(prefers-reduced-motion: reduce), (forced-colors: active)";

/** 高光属于表单，由 CSS 读取位置，指针移动无需重渲染编辑器。 */
function useAgentComposerHighlight(
  form_ref: RefObject<HTMLFormElement | null>,
  enabled: boolean,
): void {
  useEffect(() => {
    const form = form_ref.current;
    if (!enabled || form === null) return;

    const preference = window.matchMedia(COMPOSER_HIGHLIGHT_DISABLED);
    const listeners = new AbortController();
    const options = { signal: listeners.signal };
    let frame: number | null = null; // 同一帧只读取一次表单位置，使用最近的指针坐标。
    let client_x = 0;
    let client_y = 0;

    const clear = (): void => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
        frame = null;
      }
      form.style.removeProperty(COMPOSER_HIGHLIGHT_POSITION);
    };

    const update = (): void => {
      frame = null;
      const { left, top, right, bottom } = form.getBoundingClientRect();
      // 候选菜单仍是表单子节点，但可以显示在边框之外。
      if (client_x < left || client_x >= right || client_y < top || client_y >= bottom) {
        clear();
        return;
      }
      form.style.setProperty(
        COMPOSER_HIGHLIGHT_POSITION,
        `${client_x - left}px ${client_y - top}px`,
      );
    };

    const move = (event: PointerEvent): void => {
      if (event.pointerType !== "mouse" || preference.matches) return;
      client_x = event.clientX;
      client_y = event.clientY;
      frame ??= window.requestAnimationFrame(update);
    };

    form.addEventListener("pointermove", move, { ...options, passive: true });
    form.addEventListener("pointerleave", clear, options);
    form.addEventListener("pointercancel", clear, options);
    preference.addEventListener("change", clear, options);
    return () => {
      listeners.abort();
      clear();
    };
  }, [enabled, form_ref]);
}

/** 视觉顶部由 CodeMirror 判断，原生覆盖软换行。 */
function can_start_input_history(view: EditorView): boolean {
  const selection = view.state.selection;
  if (selection.ranges.length !== 1 || !selection.main.empty) return false;
  return view.moveToLineBoundary(selection.main, false, true).head === 0;
}

/** 用单次事务同步正文，并将光标放在末尾。 */
function write_agent_message_text(
  view: EditorView,
  text: string,
  annotations: NonNullable<TransactionSpec["annotations"]>,
): void {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    selection: EditorSelection.cursor(text.length),
    annotations,
  });
}

/** 只读取当前行光标前的查询，允许路径包含空格。 */
function find_mention_query(state: EditorState): MentionQuery | null {
  const selection = state.selection.main;
  if (!selection.empty) return null;
  const line = state.doc.lineAt(selection.head);
  const before = state.doc.sliceString(line.from, selection.head);
  const match = before.match(/(^|\s)@([^@]*)$/u);
  if (match === null) return null;
  const from = selection.head - match[0].length + match[1]!.length;
  const token = state.field(mention_tokens_field).iter(from);
  if (token.value !== null && token.from < selection.head && token.to > from) return null;
  return { from, to: selection.head, text: match[2] ?? "" };
}

/** 把完整引用投影成原子视觉块，底层文档仍保留完整稳定协议。 */
function create_mention_token_decorations(text: string): DecorationSet {
  const ranges = find_agent_reference_ranges(text);
  const labels = resolve_agent_reference_labels(ranges);
  return Decoration.set(
    ranges.map((range, index) =>
      Decoration.replace({
        widget: new MentionTokenWidget(range, labels[index]!),
        inclusive: false,
      }).range(range.from, range.to),
    ),
    true,
  );
}

/** CodeMirror 从块起点报告悬停，按指针一侧找到对应的装饰范围。 */
function read_mention_hover(view: EditorView, pos: number, side: -1 | 1) {
  const point = side < 0 ? pos - 1 : pos;
  const token = view.state.field(mention_tokens_field).iter(point);
  if (token.value !== null && token.to === point) token.next(); // 相邻块共用边界，跳过已结束的块。
  const widget = token.value?.spec.widget;
  if (token.from > point || !(widget instanceof MentionTokenWidget) || widget.path === null)
    return null;
  return { from: token.from, to: token.to, text: widget.path };
}

/** 文件名在引用块的内层节点，按外层节点取得文件动作。 */
function find_mention_file_node(event: MouseEvent): HTMLElement | null {
  return event.target instanceof Element
    ? event.target.closest<HTMLElement>(".agent-mention-token--interactive")
    : null;
}

/** 引用块把光标限制在完整标记两侧。 */
class MentionTokenWidget extends WidgetType {
  private static readonly CURSOR_GAP_PX = 1;
  private readonly file: AgentFileTarget | null;
  private readonly range: AgentReferenceRange;
  private readonly label: string;

  /** 文件目标随装饰创建，鼠标事件复用该目标。 */
  public constructor(range: AgentReferenceRange, label: string) {
    super();
    this.range = range;
    this.label = label;
    this.file = resolve_agent_reference_file(range.reference);
  }

  /** 同名文件可改变旧块的标签，因此标签也参与 DOM 复用。 */
  public override eq(widget: WidgetType): boolean {
    return (
      widget instanceof MentionTokenWidget &&
      widget.range.marker === this.range.marker &&
      widget.label === this.label
    );
  }

  /** 文件块只把点击和菜单所需事件交给编辑器。 */
  public override ignoreEvent(event: Event): boolean {
    return (
      this.file === null ||
      (event.type !== "mousedown" && event.type !== "click" && event.type !== "contextmenu")
    );
  }

  /** 悬浮提示使用原始文件路径。 */
  public get path(): string | null {
    return this.range.reference.kind === "skill" ? null : this.range.reference.path;
  }

  /** 创建与时间线共用样式的紧凑块。 */
  public override toDOM(): HTMLElement {
    const token = document.createElement("span");
    const text = document.createElement("span");
    token.className = "agent-mention-token";
    const { reference } = this.range;
    if (reference.kind === "skill") {
      text.textContent = this.label;
      token.append(text);
    } else {
      const [prefix, value, suffix] = format_agent_reference_parts({
        ...reference,
        path: this.label,
      });
      text.textContent = value;
      token.append(prefix, text, suffix);
    }
    if (this.file !== null) {
      token.classList.add("agent-mention-token--interactive");
      mention_file_nodes.set(token, this.file);
    }
    return token;
  }

  /** 把 marker 两侧文档位置映射到视觉块边界。 */
  public override coordsAt(dom: HTMLElement, pos: number) {
    const rect = dom.getBoundingClientRect();
    const x = pos === 0 ? rect.left : rect.right + MentionTokenWidget.CURSOR_GAP_PX;
    return { left: x, right: x, top: rect.top, bottom: rect.bottom };
  }
}
