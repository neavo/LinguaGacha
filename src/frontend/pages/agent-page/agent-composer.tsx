import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { useTheme } from "next-themes";
import {
  ArrowUp,
  BookA,
  Brain,
  ChevronDown,
  Cpu,
  LoaderCircle,
  MessageSquarePlus,
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

import type { GlossaryEntry } from "@domain/quality";
import type { AgentSkillSnapshot } from "@shared/agent";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import { AppButton } from "@frontend/widgets/app-button";
import {
  AppDropdownMenu,
  AppDropdownMenuContent,
  AppDropdownMenuTrigger,
} from "@frontend/widgets/app-dropdown-menu";
import {
  resolve_app_editor_readonly_extensions,
  resolve_app_editor_theme_extensions,
} from "@frontend/widgets/app-editor/app-editor-code-mirror";
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

/** 页面只能写入草稿，正文与光标所有权仍留在 CodeMirror。 */
export type AgentComposerHandle = {
  write_draft: (text: string) => void;
};

/** 互斥于发送的新命令原因；三种状态都允许继续编辑本地草稿。 */
type AgentUnavailableReason = "restoring" | "runtime_busy" | "settling";

type AgentComposerProps = {
  ref?: Ref<AgentComposerHandle>;
  skills: readonly AgentSkillSnapshot[];
  terms: readonly GlossaryEntry[];
  term_hit_counts: Readonly<Record<string, number>>;
  running: boolean;
  compacting: boolean;
  compaction_failed: boolean;
  unavailable_reason: AgentUnavailableReason | null;
  command: AgentCommand;
  can_reset: boolean;
  context_tokens: number | null;
  model_selection: ModelSelectionController;
  input_session: AgentInputSession;
  on_send: (text: string) => void;
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
export function AgentComposer(props: AgentComposerProps): JSX.Element {
  const { locale, t } = useI18n();
  const { resolvedTheme } = useTheme();
  const placeholder_text = t("agent_page.input.placeholder");
  const compacting = props.compacting || props.command === "compact";
  const submit_label = t(
    compacting
      ? "agent_page.compaction.running"
      : props.command === "send"
        ? "agent_page.action.sending"
        : props.command === "stop"
          ? "agent_page.action.stopping"
          : props.running
            ? "agent_page.action.stop"
            : "agent_page.action.send",
  );
  const submit_command_active = props.command === "send" || props.command === "stop";
  const submit_tooltip =
    submit_command_active || props.unavailable_reason === null
      ? submit_label
      : t(AGENT_UNAVAILABLE_REASON_KEYS[props.unavailable_reason]);
  const host_ref = useRef<HTMLDivElement | null>(null);
  const menu_ref = useRef<HTMLDivElement | null>(null);
  const view_ref = useRef<EditorView | null>(null);
  const submit_ref = useRef<() => void>(() => undefined);
  const select_candidate_ref = useRef<(candidate: AgentMentionCandidate) => void>(() => undefined);
  const menu_open_ref = useRef(false);
  const matching_candidates_ref = useRef<readonly AgentMentionCandidate[]>([]);
  const menu_index_ref = useRef(0);
  const last_query_key_ref = useRef("");
  // Session 引用承接跨路由草稿与历史，索引只属于当前 Composer 的临时浏览位置。
  const input_session_ref = useRef(props.input_session);
  const input_history_index_ref = useRef<number | null>(null);
  const [snapshot, set_snapshot] = useState<EditorSnapshot>(EMPTY_EDITOR_SNAPSHOT);
  const [menu_index_value, set_menu_index] = useState(0);
  const [menu_suppressed, set_menu_suppressed] = useState(false);

  const mention_query_text = snapshot.query?.text;
  const candidate_groups =
    mention_query_text === undefined
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
  const editor_read_only = props.command === "send" || props.command === "reset";
  const menu_open = snapshot.query !== null && !editor_read_only && !menu_suppressed;
  const menu_index = Math.max(0, Math.min(menu_index_value, matching_candidates.length - 1));
  const can_send =
    !props.running &&
    !compacting &&
    !props.compaction_failed &&
    props.unavailable_reason === null &&
    props.command === null &&
    !props.model_selection.updating &&
    snapshot.text !== "";
  // 运行命令与模型快照请求分开表达，避免把加载态误当成 Agent 会话锁。
  const model_commands_disabled =
    props.running || compacting || props.unavailable_reason !== null || props.command !== null;
  const model_controls_disabled =
    model_commands_disabled || props.model_selection.loading || props.model_selection.updating;
  const selected_model = read_selected_model(props.model_selection, "agent");
  const selected_model_name =
    selected_model?.name || selected_model?.id || t("app.model.selection.unavailable");
  const selected_thinking_label =
    selected_model?.thinking_configurable === true
      ? t(MODEL_THINKING_LEVEL_LABEL_KEY[selected_model.thinking_level])
      : null;
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
    }),
    [editor_read_only],
  );

  menu_open_ref.current = menu_open;
  matching_candidates_ref.current = matching_candidates;
  menu_index_ref.current = menu_index;
  input_session_ref.current = props.input_session;

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
          theme_compartment.of(resolve_app_editor_theme_extensions(resolvedTheme, "plain")),
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
                menu_open_ref.current
                  ? navigate_mention_menu(1)
                  : navigate_input_history(view, "newer"),
            },
            {
              key: "ArrowUp",
              run: (view) =>
                menu_open_ref.current
                  ? navigate_mention_menu(-1)
                  : navigate_input_history(view, "older"),
            },
            {
              key: "Escape",
              run: () => {
                if (!menu_open_ref.current) return false;
                set_menu_suppressed(true);
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
                input_session_ref.current.write_draft(update.state.doc.toString());
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
    write_agent_message_text(
      view,
      input_session_ref.current.read_draft(),
      input_session_sync_annotations,
    );
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
        resolve_app_editor_theme_extensions(resolvedTheme, "plain"),
      ),
    });
  }, [resolvedTheme]);

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

  /** Composer 只提交当前投影；受理后的历史与草稿由常驻 Agent session 原子更新。 */
  const submit = (): void => {
    const view = view_ref.current;
    if (view === null || !can_send) return;
    const text = view.state.doc.toString().trim();
    if (text !== "") props.on_send(text);
  };
  submit_ref.current = submit;

  return (
    <form
      className="agent-composer"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
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
      <div className="agent-composer__editor">
        <div ref={host_ref} className="agent-composer__input" />
      </div>
      <div className="agent-composer__footer">
        <div className="agent-composer__footer-actions">
          <AppButton
            type="button"
            size="xs"
            variant="ghost"
            className="agent-composer__reset"
            disabled={
              !props.can_reset ||
              props.running ||
              compacting ||
              props.unavailable_reason !== null ||
              props.command !== null
            }
            onClick={props.on_reset}
          >
            <MessageSquarePlus aria-hidden="true" />
            <span>{t("agent_page.action.new_task")}</span>
          </AppButton>
          <AppDropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <AppDropdownMenuTrigger asChild>
                  <AppButton
                    type="button"
                    size="xs"
                    variant="ghost"
                    className="agent-composer__model-trigger"
                    disabled={model_controls_disabled}
                    aria-label={`${t("app.model.selection.label")}: ${selected_model_name}`}
                  >
                    <Cpu aria-hidden="true" />
                    <span>{selected_model_name}</span>
                    <ChevronDown aria-hidden="true" />
                  </AppButton>
                </AppDropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={8}>
                <p>{t("app.model.selection.label")}</p>
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
          {selected_thinking_label !== null && (
            <AppDropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <AppDropdownMenuTrigger asChild>
                    <AppButton
                      type="button"
                      size="xs"
                      variant="ghost"
                      className="agent-composer__thinking-trigger"
                      disabled={model_controls_disabled}
                      aria-label={`${t("app.model.thinking_level.label")}: ${selected_thinking_label}`}
                    >
                      <Brain aria-hidden="true" />
                      <span>{selected_thinking_label}</span>
                      <ChevronDown aria-hidden="true" />
                    </AppButton>
                  </AppDropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={8}>
                  <p>{t("app.model.thinking_level.label")}</p>
                </TooltipContent>
              </Tooltip>
              <AppDropdownMenuContent align="start" matchTriggerWidth={false}>
                <ModelThinkingLevelOptions
                  controller={props.model_selection}
                  usage="agent"
                  disabled={model_commands_disabled}
                />
              </AppDropdownMenuContent>
            </AppDropdownMenu>
          )}
          {context_usage !== null && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="agent-composer__context-usage"
                  data-tone={context_usage.tone}
                  tabIndex={0}
                  aria-label={`${t("agent_page.context_usage", {
                    percent: context_usage.percent,
                    used: context_usage.used,
                    total: context_usage.total,
                  })}${context_usage.warning ? ` · ${t("agent_page.context_usage_warning")}` : ""}`}
                >
                  {context_usage.percent}
                </span>
              </TooltipTrigger>
              <TooltipContent
                className="flex-col items-start gap-0.5 whitespace-nowrap"
                side="top"
                sideOffset={8}
              >
                <p>{`${context_usage.used} / ${context_usage.total}`}</p>
                {context_usage.warning ? <p>{t("agent_page.context_usage_warning")}</p> : null}
              </TooltipContent>
            </Tooltip>
          )}
          <span className="agent-composer__hint">{t("agent_page.input.hint")}</span>
        </div>
        <div className="agent-composer__footer-end">
          <Tooltip>
            {/* 外层触发器在按钮禁用 pointer events 时仍可承接悬停。 */}
            <TooltipTrigger asChild>
              <span className="agent-composer__submit-shell">
                <AppButton
                  className="agent-composer__submit"
                  type={
                    props.running || compacting || props.command === "stop" ? "button" : "submit"
                  }
                  size="icon-xs"
                  onClick={
                    props.running && !compacting && props.command === null
                      ? () => void props.on_stop()
                      : undefined
                  }
                  disabled={compacting || props.command !== null || (!props.running && !can_send)}
                  aria-label={submit_label}
                >
                  {compacting || submit_command_active ? (
                    <LoaderCircle className="animate-spin" aria-hidden="true" />
                  ) : props.running ? (
                    <Square aria-hidden="true" />
                  ) : (
                    <ArrowUp aria-hidden="true" />
                  )}
                </AppButton>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={8}>
              <p>{submit_tooltip}</p>
            </TooltipContent>
          </Tooltip>
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
        input_session_ref.current.read_draft(),
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
  // 为下一次回复和压缩各保留一份最大输出预算，阈值本身仍保持默认色。
  const warning = usage.tokens >= usage.contextWindow - usage.maxTokens * 2;
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
