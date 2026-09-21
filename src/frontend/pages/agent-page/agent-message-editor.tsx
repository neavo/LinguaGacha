import { find_agent_reference_ranges } from "@shared/agent-reference";
import { useAgentMentionFiles } from "./use-agent-mention-files";
import {
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
import { FileText, Paperclip, Shrink, Sparkles } from "lucide-react";

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  Annotation,
  Compartment,
  EditorSelection,
  EditorState,
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

import {
  type AgentMessageInput,
  type AgentResponseAnnotationAttachment,
  type AgentSkillSnapshot,
} from "@shared/agent";
import { useAppearance } from "@frontend/app/appearance/appearance-context";
import { useI18n } from "@frontend/app/locale/locale-context";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipTarget } from "@frontend/shadcn/tooltip";
import { AppButton } from "@frontend/widgets/app-button";
import {
  resolve_app_editor_readonly_extensions,
  resolve_app_editor_theme_extensions,
} from "@frontend/widgets/app-editor/app-editor-code-mirror";
import type { AgentInputSession } from "@frontend/app/session/agent/agent-session-context";
import {
  create_agent_mention_candidates,
  type AgentMentionCandidate,
  type AgentMentionInstruction,
} from "./agent-mention";
import type { AgentDraftAttachment } from "@frontend/app/session/agent/agent-input-draft";
import { AgentMessageAttachments } from "./agent-message-attachments";
import { AgentFileDropTarget } from "./agent-file-drop-target";

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
export type AgentMessageEditorHandle = {
  write_draft: (text: string) => void;
  add_response_annotation: (annotation: AgentResponseAnnotationAttachment) => void;
  focus: () => void;
};

type AgentEditorState = { has_content: boolean; uploads_pending: boolean };

type AgentMessageEditorProps = {
  ref?: Ref<AgentMessageEditorHandle>;
  file_drop_target_ref?: RefObject<HTMLElement | null>; // 缺省接收当前表单，主输入由页面指定整页区域
  presentation?: "composer" | "inline";
  role?: "user" | "assistant";
  read_only: boolean;
  skills: readonly AgentSkillSnapshot[];
  instructions?: readonly AgentMentionInstruction[];
  input_session: AgentInputSession;
  on_submit: (message: AgentMessageInput) => void;
  on_cancel?: () => void;
  /** 消费方统一决定按钮与提交权限，包含只读、内容和图片处理条件。 */
  render_actions: (state: AgentEditorState) => {
    can_submit: boolean;
    actions?: ReactNode;
    submit: ReactNode;
  };
};

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

const mention_tokens_field = StateField.define<DecorationSet>({
  create: (state) => create_mention_token_decorations(state.doc.toString()),
  /** 正文改变时重建引用装饰，其余事务复用结果。 */
  update(tokens, transaction) {
    if (!transaction.docChanged) return tokens;
    return create_mention_token_decorations(transaction.newDoc.toString());
  },
  /** 同一装饰范围同时拥有绘制与整块光标导航语义。 */
  provide(field) {
    return [
      EditorView.decorations.from(field),
      EditorView.atomicRanges.of((view) => view.state.field(field)),
    ];
  },
});
const mention_token_extension: Extension = [mention_tokens_field];

/** 主输入与原位编辑共享正文、附件和键盘交互，按草稿 revision 同步 CodeMirror。 */
export function AgentMessageEditor(props: AgentMessageEditorProps): JSX.Element {
  const { locale, t } = useI18n();
  const { resolved_theme } = useAppearance();
  const inline = props.presentation === "inline";
  const assistant_editing = props.role === "assistant";
  const placeholder_text = t(
    assistant_editing
      ? "agent_page.input.edit_assistant_placeholder"
      : "agent_page.input.placeholder",
  );
  const host_ref = useRef<HTMLDivElement | null>(null);
  const form_ref = useRef<HTMLFormElement | null>(null);
  const file_input_ref = useRef<HTMLInputElement | null>(null);
  const menu_ref = useRef<HTMLDivElement | null>(null);
  const view_ref = useRef<EditorView | null>(null);
  const submit_ref = useRef<() => void>(() => undefined);
  // CodeMirror 扩展只创建一次，ref 保证 Escape 调用最新的页面取消入口。
  const cancel_edit_ref = useRef(props.on_cancel);
  const select_candidate_ref = useRef<(candidate: AgentMentionCandidate) => void>(() => undefined);
  const menu_open_ref = useRef(false);
  const matching_candidates_ref = useRef<readonly AgentMentionCandidate[]>([]);
  const menu_index_ref = useRef(0);
  const last_query_key_ref = useRef("");
  // CodeMirror 回调从 ref 读取最新跨路由输入状态；历史索引只属于当前 Composer。
  const input_session_ref = useRef(props.input_session);
  const input_history_index_ref = useRef<number | null>(null);
  const draft = useSyncExternalStore(
    props.input_session.draft.subscribe,
    props.input_session.draft.read,
  );
  const draft_attachments = draft.attachments;
  const [snapshot, set_snapshot] = useState<EditorSnapshot>(EMPTY_EDITOR_SNAPSHOT);
  const uploads_pending = draft_attachments.some((attachment) => attachment.kind === "upload");
  const [menu_index_value, set_menu_index] = useState(0);
  const [menu_suppressed, set_menu_suppressed] = useState(false);

  const mention_query_text = snapshot.query?.text;
  const file_query = useAgentMentionFiles(
    !assistant_editing && mention_query_text !== undefined && !props.read_only && !menu_suppressed,
    draft_attachments
      .filter((file) => file.kind === "file")
      .map((file) => file.uploadId)
      .join("|"),
  );
  const candidate_groups =
    assistant_editing || mention_query_text === undefined
      ? { skills: [], files: [], instructions: [], fileCount: 0 }
      : create_agent_mention_candidates({
          query: mention_query_text,
          locale,
          skills: props.skills,
          files: file_query.files,
          instructions: props.instructions ?? [],
        });
  const matching_skills = candidate_groups.skills;
  const matching_files = candidate_groups.files;
  const matching_instructions = candidate_groups.instructions;
  const matching_candidates = [...matching_skills, ...matching_files, ...matching_instructions];
  const editor_read_only = props.read_only;
  const menu_open =
    !assistant_editing && snapshot.query !== null && !editor_read_only && !menu_suppressed;
  const menu_index = Math.max(0, Math.min(menu_index_value, matching_candidates.length - 1));
  const has_sendable_content =
    snapshot.text !== "" || (!assistant_editing && draft_attachments.length > 0);
  const actions = props.render_actions({ has_content: has_sendable_content, uploads_pending });
  const can_append_files = !editor_read_only && !assistant_editing;
  // CodeMirror 扩展只创建一次，文件拖放读取当前上传权限。
  const can_append_files_ref = useRef(can_append_files);
  can_append_files_ref.current = can_append_files;
  // 编辑器只创建一次，首次锁定态必须在首帧扩展中生效，不能等待后续 effect。
  const initial_editor_read_only_ref = useRef(editor_read_only);
  const input_revision = props.input_session.revision;

  menu_open_ref.current = menu_open;
  matching_candidates_ref.current = matching_candidates;
  menu_index_ref.current = menu_index;
  input_session_ref.current = props.input_session;
  cancel_edit_ref.current = editor_read_only ? undefined : props.on_cancel;

  useEffect(() => {
    const host = host_ref.current;
    if (host === null) return;
    // 单次读取编辑器事实，再同步 React 消费的派生状态。
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
            drop: (event) => {
              const transfer = event.dataTransfer;
              if (transfer === null || !Array.from(transfer.types).includes("Files")) return false;
              // 在 CodeMirror 读取文本文件前消费事件，上传只进入当前编辑器的草稿。
              event.preventDefault();
              event.stopPropagation();
              if (can_append_files_ref.current)
                input_session_ref.current.draft.append(transfer.files);
              return true;
            },
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
              if (
                docChanged &&
                !transactions.every(
                  (transaction) =>
                    transaction.annotation(input_history_navigation_annotation) === true,
                )
              ) {
                input_history_index_ref.current = null;
                input_session_ref.current.draft.write({
                  text: state.doc.toString(),
                  attachments: input_session_ref.current.draft.read().attachments,
                });
              }
              emit_snapshot(state);
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
    const current = input_session_ref.current.draft.read();
    if (view.state.doc.toString() === current.text) return;
    input_history_index_ref.current = null;
    write_agent_message_text(view, current.text, input_session_sync_annotations);
  }, [props.input_session, input_revision, draft.text]);

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

  /** 技能写入 marker；指令移除筛选文本后立即执行，不进入消息或草稿历史。 */
  const select_candidate = (candidate: AgentMentionCandidate): void => {
    const view = view_ref.current;
    const query = view === null ? null : find_mention_query(view.state);
    if (view === null || query === null) return;
    if (candidate.kind === "instruction") {
      if (candidate.disabled) return;
      view.dispatch({
        changes: { from: query.from, to: query.to, insert: "" },
        selection: EditorSelection.cursor(query.from),
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
    input_session_ref.current.draft.write({
      text: view_ref.current?.state.doc.toString() ?? input_session_ref.current.draft.read().text,
      attachments,
    });
  }, []);

  /** 输入只交给常驻草稿，上传状态和取消由草稿自身拥有。 */
  const append_files = (files: Iterable<File>): void => {
    if (can_append_files) props.input_session.draft.append(files);
  };

  /** 按混合附件列表的原始索引删除，并同步权威草稿。 */
  const remove_attachment = (index: number): void => {
    write_draft_attachments(
      input_session_ref.current.draft
        .read()
        .attachments.filter((_, attachment_index) => attachment_index !== index),
    );
  };

  /** 附件组件只提交用户意图，Composer 仍在当前权威草稿中按原索引写入。 */
  const update_annotation = (index: number, comment: string): void => {
    const current = input_session_ref.current.draft.read().attachments;
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
      /** 外部草稿替换退出历史导航，并遵循当前编辑锁。 */
      write_draft(text) {
        const view = view_ref.current;
        if (view === null || editor_read_only) return;
        input_history_index_ref.current = null;
        write_agent_message_text(view, text);
        view.focus();
      },
      /** 复制批注后加入当前草稿，助手历史编辑遵循纯正文边界。 */
      add_response_annotation(annotation) {
        if (editor_read_only || assistant_editing) return;
        write_draft_attachments([
          ...input_session_ref.current.draft.read().attachments,
          structuredClone(annotation),
        ]);
        view_ref.current?.focus();
      },
      /** 页面动作完成后将焦点交回当前编辑器。 */
      focus() {
        view_ref.current?.focus();
      },
    }),
    [assistant_editing, editor_read_only, write_draft_attachments],
  );

  /** Composer 只提交当前投影；受理后的历史与草稿由常驻 Agent session 原子更新。 */
  const submit = (): void => {
    const view = view_ref.current;
    if (view === null || !actions.can_submit) return;
    const text = view.state.doc.toString().trim();
    if (
      input_session_ref.current.draft
        .read()
        .attachments.some((attachment) => attachment.kind === "upload")
    )
      return;
    props.on_submit({
      text,
      attachments: structuredClone(
        input_session_ref.current.draft
          .read()
          .attachments.filter((attachment) => attachment.kind !== "upload"),
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
        append_files(event.clipboardData.files);
      }}
    >
      <AgentFileDropTarget
        target_ref={props.file_drop_target_ref ?? form_ref}
        enabled={can_append_files}
        on_files={append_files}
      />
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
          {(matching_files.length > 0 ||
            file_query.status === "loading" ||
            file_query.status === "error") && (
            <div
              className="agent-mention-menu__group"
              role="group"
              aria-labelledby="agent-mention-files-label"
            >
              <div id="agent-mention-files-label" className="agent-mention-menu__group-label">
                {t("agent_page.mention.groups.files")}
              </div>
              {matching_files.map((candidate, index) =>
                render_candidate(candidate, matching_skills.length + index),
              )}
              {file_query.status === "loading" && (
                <p className="agent-mention-menu__empty">{t("agent_page.mention.files.loading")}</p>
              )}
              {file_query.status === "error" && (
                <p className="agent-mention-menu__empty">{t("agent_page.mention.files.error")}</p>
              )}
              {candidate_groups.fileCount > matching_files.length && (
                <p className="agent-mention-menu__empty">{t("agent_page.mention.files.more")}</p>
              )}
            </div>
          )}
          {matching_instructions.length > 0 && (
            <div
              className="agent-mention-menu__group"
              role="group"
              aria-labelledby="agent-mention-instructions-label"
            >
              <div
                id="agent-mention-instructions-label"
                className="agent-mention-menu__group-label"
              >
                {t("agent_page.mention.groups.instructions")}
              </div>
              {matching_instructions.map((candidate, index) =>
                render_candidate(candidate, matching_skills.length + matching_files.length + index),
              )}
            </div>
          )}
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
          on_retry={(id) => props.input_session.draft.retry(id)}
        />
      ) : null}
      <div className="agent-composer__editor">
        <div ref={host_ref} className="agent-composer__input" />
      </div>
      <input
        ref={file_input_ref}
        className="agent-composer__file-input"
        type="file"
        multiple
        tabIndex={-1}
        onChange={(event) => {
          append_files(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
        }}
      />
      <div className="agent-composer__footer">
        <div className="agent-composer__footer-actions">
          {!assistant_editing ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <TooltipTarget>
                    <AppButton
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      className="agent-composer__file-trigger"
                      disabled={!can_append_files}
                      aria-label={t("agent_page.action.add_file")}
                      onClick={() => file_input_ref.current?.click()}
                    >
                      <Paperclip aria-hidden="true" />
                    </AppButton>
                  </TooltipTarget>
                }
              />
              <TooltipContent>
                <p>{t("agent_page.action.add_file")}</p>
              </TooltipContent>
            </Tooltip>
          ) : null}
          {actions.actions}
        </div>
        <div className="agent-composer__footer-end">{actions.submit}</div>
      </div>
    </form>
  );

  /** 所有分组共用连续 option 索引，使键盘导航与 aria-activedescendant 指向同一项。 */
  function render_candidate(candidate: AgentMentionCandidate, index: number): JSX.Element {
    const Icon =
      candidate.kind === "skill" ? Sparkles : candidate.kind === "file" ? FileText : Shrink;
    return (
      <button
        id={`agent-mention-option-${index.toString()}`}
        key={candidate.key}
        type="button"
        role="option"
        aria-selected={index === menu_index}
        disabled={candidate.kind === "instruction" && candidate.disabled}
        data-highlight={index === menu_index}
        data-kind={candidate.kind}
        tabIndex={-1}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => select_candidate(candidate)}
      >
        <Icon aria-hidden="true" />
        <MentionCell text={candidate.title} emphasis />
        <MentionCell text={candidate.description} />
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
        input_session_ref.current.draft.read().text,
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

/** 单次读取编辑器派生视图，避免 React 再维护一份可写草稿事实。 */
function read_editor_snapshot(state: EditorState): EditorSnapshot {
  return {
    text: state.doc.toString().trim(),
    query: find_mention_query(state),
  };
}

/** 只读取当前行光标前的查询，允许路径包含空格。 */
function find_mention_query(state: EditorState): MentionQuery | null {
  const selection = state.selection.main;
  if (!selection.empty) return null;
  const line = state.doc.lineAt(selection.head);
  const before = state.doc.sliceString(line.from, selection.head);
  const match = before.match(/(^|\s)@([^@]*)$/u);
  if (match === null) return null;
  const from = selection.head - match[0].length + match[1].length;
  const token = state.field(mention_tokens_field).iter(from);
  if (token.value !== null && token.from < selection.head && token.to > from) return null;
  return { from, to: selection.head, text: match[2] ?? "" };
}

/** 把完整引用投影成原子视觉块，底层文档仍保留完整稳定协议。 */
function create_mention_token_decorations(text: string): DecorationSet {
  return Decoration.set(
    find_agent_reference_ranges(text).map((range) =>
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

/** 两列共用截断与应用提示，触发器保持为文本元素，整行负责选择。 */
function MentionCell({
  text,
  emphasis = false,
}: {
  text: string;
  emphasis?: boolean;
}): JSX.Element {
  const cell = emphasis ? <strong>{text}</strong> : <small>{text}</small>;
  if (text === "") return cell;
  return (
    <Tooltip>
      <TooltipTrigger render={cell} tabIndex={-1} />
      <TooltipContent align="start">{text}</TooltipContent>
    </Tooltip>
  );
}
