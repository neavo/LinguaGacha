import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { ArrowUp, ChevronDown, Cpu, MessageSquarePlus, Square } from "lucide-react";

import { defaultKeymap, history, historyKeymap, invertedEffects } from "@codemirror/commands";
import {
  Compartment,
  EditorSelection,
  EditorState,
  StateEffect,
  StateField,
  type Extension,
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

import type { AgentSkillSnapshot, AgentUserMessagePart } from "@shared/agent";
import { useI18n } from "@frontend/app/locale/locale-provider";
import { ModelSelectionCategories } from "@frontend/features/model-selection/model-selection-menu";
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

/** 光标前尚未确认的 @ 查询范围；确认后会被替换为 Decoration。 */
type SkillQuery = {
  from: number;
  to: number;
  text: string;
};

/** React 只持有渲染所需投影，正文与 token 仍由 EditorState 唯一拥有。 */
type EditorSnapshot = {
  parts: AgentUserMessagePart[];
  query: SkillQuery | null;
  selected_skill_names: Set<string>;
};

type AgentComposerProps = {
  skills: readonly AgentSkillSnapshot[];
  running: boolean;
  error: boolean;
  can_reset: boolean;
  resetting: boolean;
  model_selection: ModelSelectionController;
  on_send: (parts: readonly AgentUserMessagePart[]) => Promise<boolean>;
  on_stop: () => Promise<void>;
  on_reset: () => void;
};

const EMPTY_EDITOR_SNAPSHOT: EditorSnapshot = {
  parts: [],
  query: null,
  selected_skill_names: new Set(),
};
// 三个 Compartment 只承接运行期配置，不参与草稿或 token 事实。
const theme_compartment = new Compartment();
const read_only_compartment = new Compartment();
const placeholder_compartment = new Compartment();

/** DecorationSet 是 skill 原子范围的唯一事实；effect 只负责让撤销历史恢复整组范围。 */
const set_skill_tokens_effect = StateEffect.define<DecorationSet>({
  map: (tokens, changes) => tokens.map(changes),
});

const skill_tokens_field = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(tokens, transaction) {
    let next = tokens.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(set_skill_tokens_effect)) {
        next = effect.value;
      }
    }
    return next.update({
      filter: (from, to, decoration) => {
        const name = read_skill_token_name(decoration);
        return name !== null && transaction.newDoc.sliceString(from, to) === `@${name}`;
      },
    });
  },
  provide(field) {
    return [
      EditorView.decorations.from(field),
      EditorView.atomicRanges.of((view) => view.state.field(field)),
    ];
  },
});

const skill_token_extension: Extension = [
  skill_tokens_field,
  EditorState.transactionExtender.of((transaction) => {
    if (
      !transaction.docChanged ||
      transaction.effects.some((effect) => effect.is(set_skill_tokens_effect))
    ) {
      return null;
    }
    return {
      effects: set_skill_tokens_effect.of(
        transaction.startState.field(skill_tokens_field).map(transaction.changes),
      ),
    };
  }),
  invertedEffects.of((transaction) =>
    transaction.effects.some((effect) => effect.is(set_skill_tokens_effect))
      ? [set_skill_tokens_effect.of(transaction.startState.field(skill_tokens_field))]
      : [],
  ),
];

/** 页面私有的结构化消息编辑器，不把 Agent 领域状态泄漏到通用 AppEditor。 */
export function AgentComposer(props: AgentComposerProps): JSX.Element {
  const { t } = useI18n();
  const { resolvedTheme } = useTheme();
  const placeholder_text = t("agent_page.input.placeholder");
  const submit_label = t(props.running ? "agent_page.action.stop" : "agent_page.action.send");
  const submit_tooltip = submit_label;
  const host_ref = useRef<HTMLDivElement | null>(null);
  const view_ref = useRef<EditorView | null>(null);
  const submit_ref = useRef<() => void>(() => undefined);
  const select_skill_ref = useRef<(skill: AgentSkillSnapshot) => void>(() => undefined);
  const menu_open_ref = useRef(false);
  const matching_skills_ref = useRef<readonly AgentSkillSnapshot[]>([]);
  const menu_index_ref = useRef(0);
  const last_query_key_ref = useRef("");
  const [snapshot, set_snapshot] = useState<EditorSnapshot>(EMPTY_EDITOR_SNAPSHOT);
  const [menu_index_value, set_menu_index] = useState(0);
  const [menu_suppressed, set_menu_suppressed] = useState(false);
  const [submitting, set_submitting] = useState(false);

  const query_text = snapshot.query?.text.toLocaleLowerCase();
  const matching_skills =
    query_text === undefined
      ? []
      : props.skills.filter(
          (skill) =>
            !snapshot.selected_skill_names.has(skill.name) &&
            `${skill.name}\n${skill.description}`.toLocaleLowerCase().includes(query_text),
        );
  const editor_read_only = props.resetting || submitting;
  const menu_open = !editor_read_only && !menu_suppressed && matching_skills.length > 0;
  const menu_index = Math.max(0, Math.min(menu_index_value, matching_skills.length - 1));
  const can_send =
    !props.running &&
    !props.resetting &&
    !submitting &&
    !props.model_selection.updating &&
    snapshot.parts.some((part) => part.kind === "skill" || part.text.trim() !== "");
  const selected_model = read_selected_model(props.model_selection, "agent");
  const selected_model_name =
    selected_model?.name || selected_model?.id || t("app.model.selection.unavailable");
  // 编辑器只创建一次，首次锁定态必须在首帧扩展中生效，不能等待后续 effect。
  const initial_editor_read_only_ref = useRef(editor_read_only);

  menu_open_ref.current = menu_open;
  matching_skills_ref.current = matching_skills;
  menu_index_ref.current = menu_index;

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
          skill_token_extension,
          // widget 边界坐标必须由 CodeMirror 绘制光标消费，不能回退到 Chromium 原生 caret。
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
              run: () => navigate_menu(1),
            },
            {
              key: "ArrowUp",
              run: () => navigate_menu(-1),
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
                const skill = matching_skills_ref.current[menu_index_ref.current];
                if (menu_open_ref.current && skill !== undefined) select_skill_ref.current(skill);
                else submit_ref.current();
                return true;
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged || update.selectionSet) emit_snapshot(update.state);
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
      content.setAttribute("aria-controls", "agent-skill-menu");
      content.setAttribute(
        "aria-activedescendant",
        `agent-skill-${matching_skills[menu_index]?.name ?? ""}`,
      );
    } else {
      content.removeAttribute("aria-controls");
      content.removeAttribute("aria-activedescendant");
    }
  }, [matching_skills, menu_index, menu_open]);

  const select_skill = (skill: AgentSkillSnapshot): void => {
    const view = view_ref.current;
    const query = view === null ? null : find_skill_query(view.state);
    if (view === null || query === null || snapshot.selected_skill_names.has(skill.name)) return;
    const text = `@${skill.name}`;
    const changes = view.state.changes({ from: query.from, to: query.to, insert: text });
    const tokens = view.state
      .field(skill_tokens_field)
      .map(changes)
      .update({
        add: [
          create_skill_token_decoration(skill.name).range(query.from, query.from + text.length),
        ],
        sort: true,
      });
    view.dispatch({
      changes,
      selection: EditorSelection.cursor(query.from + text.length),
      effects: set_skill_tokens_effect.of(tokens),
    });
    set_menu_suppressed(false);
    view.focus();
  };
  select_skill_ref.current = select_skill;

  const submit = async (): Promise<void> => {
    const view = view_ref.current;
    if (view === null || !can_send) return;
    const parts = read_agent_message_parts(view.state);
    set_submitting(true);
    try {
      if (await props.on_send(parts)) {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: "" },
          selection: EditorSelection.cursor(0),
          effects: set_skill_tokens_effect.of(Decoration.none),
        });
      }
    } finally {
      set_submitting(false);
    }
  };
  submit_ref.current = () => void submit();

  return (
    <form
      className="agent-composer"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {menu_open && (
        <div id="agent-skill-menu" className="agent-skill-menu" role="listbox">
          {matching_skills.map((skill, index) => (
            <button
              id={`agent-skill-${skill.name}`}
              key={skill.name}
              type="button"
              role="option"
              aria-selected={index === menu_index}
              data-highlight={index === menu_index}
              tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => select_skill(skill)}
            >
              <strong>{skill.name}</strong>
              <small>{skill.description}</small>
            </button>
          ))}
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
            disabled={!props.can_reset || props.resetting || submitting}
            onClick={props.on_reset}
          >
            <MessageSquarePlus aria-hidden="true" />
            <span>{t("agent_page.action.new_task")}</span>
          </AppButton>
          <AppDropdownMenu>
            <AppDropdownMenuTrigger asChild>
              <AppButton
                type="button"
                size="xs"
                variant="ghost"
                className="agent-composer__model-trigger"
                disabled={
                  props.running ||
                  props.resetting ||
                  props.model_selection.loading ||
                  props.model_selection.updating
                }
                aria-label={t("app.model.selection.label")}
                title={selected_model_name}
              >
                <Cpu aria-hidden="true" />
                <span>{selected_model_name}</span>
                <ChevronDown aria-hidden="true" />
              </AppButton>
            </AppDropdownMenuTrigger>
            <AppDropdownMenuContent align="start" matchTriggerWidth={false}>
              <ModelSelectionCategories
                controller={props.model_selection}
                usage="agent"
                disabled={props.running || props.resetting}
              />
            </AppDropdownMenuContent>
          </AppDropdownMenu>
          <span className="agent-composer__hint">{t("agent_page.input.hint")}</span>
        </div>
        <div className="agent-composer__footer-end">
          {props.error && <span className="agent-composer__error">{t("agent_page.error")}</span>}
          <Tooltip>
            {/* 外层触发器在按钮禁用 pointer events 时仍可承接悬停。 */}
            <TooltipTrigger asChild>
              <span className="agent-composer__submit-shell">
                <AppButton
                  className="agent-composer__submit"
                  type={props.running ? "button" : "submit"}
                  size="icon-xs"
                  onClick={props.running ? () => void props.on_stop() : undefined}
                  disabled={props.resetting || (!props.running && !can_send)}
                  aria-label={submit_label}
                >
                  {props.running ? <Square aria-hidden="true" /> : <ArrowUp aria-hidden="true" />}
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

  /** 菜单打开时循环选择候选；关闭时把方向键交还 CodeMirror。 */
  function navigate_menu(delta: 1 | -1): boolean {
    if (!menu_open_ref.current || matching_skills_ref.current.length === 0) return false;
    set_menu_index(
      (current) =>
        (current + delta + matching_skills_ref.current.length) % matching_skills_ref.current.length,
    );
    return true;
  }
}

/** 按 DecorationSet 投影 parts，并只裁剪整条组合消息的文本外缘。 */
function read_agent_message_parts(state: EditorState): AgentUserMessagePart[] {
  const parts: AgentUserMessagePart[] = [];
  let cursor = 0;
  state.field(skill_tokens_field).between(0, state.doc.length, (from, to, decoration) => {
    const name = read_skill_token_name(decoration);
    if (name === null) return;
    if (from > cursor) {
      parts.push({ kind: "text", text: state.doc.sliceString(cursor, from) });
    }
    parts.push({ kind: "skill", name });
    cursor = to;
  });
  if (cursor < state.doc.length) {
    parts.push({ kind: "text", text: state.doc.sliceString(cursor) });
  }
  const first = parts[0];
  if (first?.kind === "text") first.text = first.text.trimStart();
  const last = parts.at(-1);
  if (last?.kind === "text") last.text = last.text.trimEnd();
  return parts.filter((part) => part.kind === "skill" || part.text !== "");
}

/** 单次读取编辑器派生视图，避免 React 再维护一份可写草稿事实。 */
function read_editor_snapshot(state: EditorState): EditorSnapshot {
  const parts = read_agent_message_parts(state);
  return {
    parts,
    query: find_skill_query(state),
    selected_skill_names: new Set(
      parts.flatMap((part) => (part.kind === "skill" ? [part.name] : [])),
    ),
  };
}

/** 只把光标前当前单词视为查询，不把已确认的原子 token 再次打开为菜单。 */
function find_skill_query(state: EditorState): SkillQuery | null {
  const selection = state.selection.main;
  if (!selection.empty) return null;
  const line = state.doc.lineAt(selection.head);
  const before = state.doc.sliceString(line.from, selection.head);
  const match = before.match(/(^|\s)@([^\s@]*)$/u);
  if (match === null) return null;
  const from = selection.head - match[0].length + match[1].length;
  const to = selection.head;
  const token = state.field(skill_tokens_field).iter(from);
  if (token.value !== null && token.from < to && token.to > from) return null;
  return { from, to, text: match[2] ?? "" };
}

/** replace widget 拥有完整视觉盒，光标只能停在原子 skill 的两侧。 */
class SkillTokenWidget extends WidgetType {
  private static readonly CURSOR_GAP_PX = 1;
  private readonly name: string;

  constructor(name: string) {
    super();
    this.name = name;
  }

  override eq(widget: WidgetType): boolean {
    return widget instanceof SkillTokenWidget && widget.name === this.name;
  }

  override toDOM(): HTMLElement {
    const token = document.createElement("span");
    token.className = "agent-skill-token";
    token.textContent = `@${this.name}`;
    return token;
  }

  override coordsAt(
    dom: HTMLElement,
    pos: number,
  ): {
    left: number;
    right: number;
    top: number;
    bottom: number;
  } {
    const rect = dom.getBoundingClientRect();
    // CodeMirror 光标线向左占宽，右边界需留出间隙才能保持在色块之外。
    const x = pos === 0 ? rect.left : rect.right + SkillTokenWidget.CURSOR_GAP_PX;
    return { left: x, right: x, top: rect.top, bottom: rect.bottom };
  }
}

/** 文档保留原始 @name，replace decoration 只负责原子交互与 DOM 投影。 */
function create_skill_token_decoration(name: string): Decoration {
  return Decoration.replace({
    widget: new SkillTokenWidget(name),
    inclusive: false,
    skill_name: name,
  });
}

/** 从 decoration spec 安全读取 skill 名，拒绝非字符串的外部值。 */
function read_skill_token_name(decoration: Decoration): string | null {
  const name = (decoration.spec as { skill_name?: unknown }).skill_name;
  return typeof name === "string" ? name : null;
}
