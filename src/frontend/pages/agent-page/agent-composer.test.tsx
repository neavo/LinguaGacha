import { act, createRef, type ComponentProps, type ReactNode, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cursorCharBackward,
  deleteCharBackward,
  deleteCharForward,
  redo,
  undo,
} from "@codemirror/commands";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { AgentUserMessagePart } from "@shared/agent";
import type { Locale } from "@shared/i18n/types";
import type { AgentInputSession } from "@frontend/app/session/agent/agent-session-context";
import {
  AGENT_INPUT_HISTORY_STORAGE_KEY,
  append_agent_input_history,
  read_agent_input_history,
} from "@frontend/app/session/agent/agent-input-history";

import { AgentComposer, type AgentComposerHandle } from "./agent-composer";

type AgentComposerTestProps = ComponentProps<typeof AgentComposer>;
type RenderComposerOptions = Partial<
  Pick<
    AgentComposerTestProps,
    | "can_reset"
    | "command"
    | "context_usage"
    | "issue"
    | "on_reset"
    | "on_send"
    | "on_stop"
    | "running"
    | "unavailable_reason"
  >
> & {
  composer_ref?: RefObject<AgentComposerHandle | null>;
  input_session?: AgentInputSession;
  model_selection?: { loading?: boolean; updating?: boolean };
};

type TestAgentInputSession = AgentInputSession & {
  accept_message: (parts: readonly AgentUserMessagePart[]) => void;
};

/** 测试通过真实重渲染读取当前 locale，只替换应用 Provider 边界。 */
const locale_state = vi.hoisted(() => ({ value: "zh-CN" as Locale }));
/** 只列当前组件断言涉及的可见文案，其余 key 原样返回以便定位。 */
const TEST_MESSAGES = vi.hoisted(() => ({
  "agent_page.input.placeholder": "描述任务，或输入 @ 选择能力 …",
  "agent_page.input.hint": "Enter 发送 · Shift + Enter 换行",
  "agent_page.context_usage_warning": "接近上下文上限，将在达到阈值后自动整理历史",
  "agent_page.action.send": "发送",
  "agent_page.action.stop": "停止",
  "agent_page.error.send": "发送失败，草稿已保留。",
  "agent_page.unavailable.restoring": "正在恢复会话",
  "agent_page.unavailable.runtime_busy": "其它任务正在运行",
  "agent_page.unavailable.settling": "正在结束当前任务",
  "app.model.selection.label": "选择模型",
  "app.model.thinking_level.label": "思考等级",
  "app.model.thinking_level.medium": "中",
}));

vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("@frontend/shadcn/tooltip", () => ({
  Tooltip: (props: { children: ReactNode }) => <>{props.children}</>,
  TooltipTrigger: (props: { children: ReactNode }) => <>{props.children}</>,
  TooltipContent: (props: { children: ReactNode }) => <div role="tooltip">{props.children}</div>,
}));
vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({
    locale: locale_state.value,
    t: (key: string, params?: Record<string, string>) =>
      key === "agent_page.context_usage"
        ? `上下文 ${params?.["percent"]} · ${params?.["used"]} / ${params?.["total"]}`
        : (TEST_MESSAGES[key as keyof typeof TEST_MESSAGES] ?? key),
  }),
}));

const skills = [
  {
    name: "glossary-audit",
    displayDescriptions: {
      "zh-CN": "审校术语",
      "en-US": "Review glossary",
      "de-DE": "Glossar prüfen",
    },
  },
  {
    name: "corpus-search",
    displayDescriptions: {
      "zh-CN": "检索语料",
      "en-US": "Search corpus",
      "de-DE": "Korpus durchsuchen",
    },
  },
];

describe("AgentComposer", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let default_input_session: TestAgentInputSession | null = null;

  afterEach(async () => {
    if (root !== null) await act(async () => root?.unmount());
    container?.remove();
    container = null;
    root = null;
    default_input_session = null;
    locale_state.value = "zh-CN";
    window.localStorage.clear();
  });

  it("在当前光标查询并混排多个唯一 skill，保留查询后的文本", async () => {
    const view = await render_composer();
    const editor = get_editor(view);
    await set_document(editor, "前 @cor 后", 6);

    const menu = await wait_for_element(view, '[role="listbox"]');
    expect(menu.querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(menu.textContent).toContain("corpus-search");
    await act(async () => menu.querySelector<HTMLButtonElement>('button[role="option"]')?.click());
    expect(editor.state.doc.toString()).toBe("前 @corpus-search 后");
    expect(view.querySelector(".agent-skill-token")?.textContent).toBe("@corpus-search");

    await act(async () => {
      editor.dispatch({
        changes: { from: editor.state.doc.length, insert: " @" },
        selection: EditorSelection.cursor(editor.state.doc.length + 2),
      });
    });
    const next_menu = await wait_for_element(view, '[role="listbox"]');
    expect(next_menu.textContent).toContain("glossary-audit");
    expect(next_menu.textContent).not.toContain("corpus-search");
  });

  it("按当前应用语言搜索并显示 skill 描述", async () => {
    locale_state.value = "en-US";
    const view = await render_composer();
    const editor = get_editor(view);
    await set_document(editor, "@review", 7);

    const menu = await wait_for_element(view, '[role="listbox"]');
    expect(menu.textContent).toContain("glossary-audit");
    expect(menu.textContent).toContain("Review glossary");
    expect(menu.textContent).not.toContain("审校术语");
  });

  it("从空输入框双向浏览全部用户消息并停在两端", async () => {
    seed_input_history([
      [{ kind: "text", text: "最旧消息" }],
      [{ kind: "text", text: "较旧消息" }],
      [{ kind: "text", text: "最新消息" }],
    ]);
    const view = await render_composer();
    const editor = get_editor(view);

    for (const [key, expected] of [
      ["ArrowDown", ""],
      ["ArrowUp", "最新消息"],
      ["ArrowUp", "较旧消息"],
      ["ArrowUp", "最旧消息"],
      ["ArrowUp", "最旧消息"],
      ["ArrowDown", "较旧消息"],
      ["ArrowDown", "最新消息"],
      ["ArrowDown", ""],
      ["ArrowDown", ""],
    ] as const) {
      await dispatch_key(editor.contentDOM, key);
      expect(editor.state.doc.toString()).toBe(expected);
    }
  });

  it("历史回填恢复 skill 语义且不污染撤销栈", async () => {
    const on_send = vi.fn();
    seed_input_history([
      [
        { kind: "text", text: "检查 " },
        { kind: "skill", name: "glossary-audit" },
      ],
    ]);
    const view = await render_composer({ on_send });
    const editor = get_editor(view);

    await dispatch_key(editor.contentDOM, "ArrowUp");
    expect(editor.state.doc.toString()).toBe("检查 @glossary-audit");
    expect(view.querySelector(".agent-skill-token")?.textContent).toBe("@glossary-audit");
    expect(undo(editor)).toBe(false);
    await click_send(view);
    expect(on_send).toHaveBeenCalledWith([
      { kind: "text", text: "检查 " },
      { kind: "skill", name: "glossary-audit" },
    ]);
    await dispatch_key(editor.contentDOM, "ArrowDown");
    expect(editor.state.doc.toString()).toBe("");
  });

  it("保存非空结构化草稿并在越过最新历史时完整恢复", async () => {
    const composer_ref = createRef<AgentComposerHandle>();
    const on_send = vi.fn();
    seed_input_history([[{ kind: "text", text: "最新消息" }]]);
    const view = await render_composer({
      composer_ref,
      on_send,
    });
    const editor = get_editor(view);

    await act(async () => {
      composer_ref.current?.write_draft([
        { kind: "text", text: "  检查 " },
        { kind: "skill", name: "glossary-audit" },
        { kind: "text", text: " 待处理  " },
      ]);
      editor.dispatch({ selection: EditorSelection.cursor(0) });
    });
    await dispatch_key(editor.contentDOM, "ArrowUp");
    expect(editor.state.doc.toString()).toBe("最新消息");

    await dispatch_key(editor.contentDOM, "ArrowDown");
    expect(editor.state.doc.toString()).toBe("  检查 @glossary-audit 待处理  ");
    expect(view.querySelector(".agent-skill-token")?.textContent).toBe("@glossary-audit");
    expect(editor.state.selection.main.head).toBe(editor.state.doc.length);
    await click_send(view);
    expect(on_send).toHaveBeenCalledWith([
      { kind: "text", text: "检查 " },
      { kind: "skill", name: "glossary-audit" },
      { kind: "text", text: " 待处理" },
    ]);
  });

  it("第一视觉行的非零光标首次 ArrowUp 就进入历史", async () => {
    seed_input_history([[{ kind: "text", text: "最新消息" }]]);
    const view = await render_composer();
    const editor = get_editor(view);
    await set_document(editor, "普通草稿", 4);

    await dispatch_key(editor.contentDOM, "ArrowUp");

    expect(editor.state.doc.toString()).toBe("最新消息");
  });

  it("未到最上方视觉行时把 ArrowUp 交还 CodeMirror", async () => {
    seed_input_history([[{ kind: "text", text: "最新消息" }]]);
    const view = await render_composer();
    const editor = get_editor(view);
    const draft = "第一行\n第二行";
    await set_document(editor, draft, draft.length);

    await dispatch_key(editor.contentDOM, "ArrowUp");

    expect(editor.state.doc.toString()).toBe(draft);
    expect(editor.state.doc.lineAt(editor.state.selection.main.head).number).toBe(1);
  });

  it("修改回填消息后退出导航且不恢复旧草稿", async () => {
    seed_input_history([[{ kind: "text", text: "最新消息" }]]);
    const view = await render_composer();
    const editor = get_editor(view);
    await set_document(editor, "原草稿", 0);
    await dispatch_key(editor.contentDOM, "ArrowUp");
    await act(async () => {
      editor.dispatch({ changes: { from: editor.state.doc.length, insert: "已修改" } });
    });

    await dispatch_key(editor.contentDOM, "ArrowDown");

    expect(editor.state.doc.toString()).toBe("最新消息已修改");
  });

  it("只移动选区时保留历史导航位置", async () => {
    seed_input_history([
      [{ kind: "text", text: "较旧消息" }],
      [{ kind: "text", text: "最新消息" }],
    ]);
    const view = await render_composer();
    const editor = get_editor(view);
    await dispatch_key(editor.contentDOM, "ArrowUp");
    await act(async () => {
      editor.dispatch({ selection: EditorSelection.cursor(0) });
    });

    await dispatch_key(editor.contentDOM, "ArrowUp");

    expect(editor.state.doc.toString()).toBe("较旧消息");
  });

  it("write_draft 即使写入相同内容也显式退出历史导航", async () => {
    const composer_ref = createRef<AgentComposerHandle>();
    seed_input_history([[{ kind: "text", text: "最新消息" }]]);
    const view = await render_composer({ composer_ref });
    const editor = get_editor(view);
    await set_document(editor, "原草稿", 0);
    await dispatch_key(editor.contentDOM, "ArrowUp");
    expect(editor.state.doc.toString()).toBe("最新消息");

    await act(async () => {
      composer_ref.current?.write_draft([{ kind: "text", text: "最新消息" }]);
    });
    await dispatch_key(editor.contentDOM, "ArrowDown");

    expect(editor.state.doc.toString()).toBe("最新消息");
  });

  it("非空选区不启动历史导航", async () => {
    seed_input_history([[{ kind: "text", text: "最新消息" }]]);
    const view = await render_composer();
    const editor = get_editor(view);
    await set_document(editor, "普通草稿", 4);
    await act(async () => {
      editor.dispatch({ selection: EditorSelection.range(0, 4) });
    });

    await dispatch_key(editor.contentDOM, "ArrowUp");

    expect(editor.state.doc.toString()).toBe("普通草稿");
  });

  it("skill 菜单优先消费历史导航方向键", async () => {
    seed_input_history([[{ kind: "text", text: "@" }]]);
    const view = await render_composer();
    const editor = get_editor(view);
    await dispatch_key(editor.contentDOM, "ArrowUp");
    const menu = await wait_for_element(view, '[role="listbox"]');

    await dispatch_key(editor.contentDOM, "ArrowDown");

    expect(editor.state.doc.toString()).toBe("@");
    expect(menu.querySelector('[data-highlight="true"]')?.textContent).toContain("corpus-search");

    await dispatch_key(editor.contentDOM, "Enter");
    await dispatch_key(editor.contentDOM, "ArrowDown");
    expect(editor.state.doc.toString()).toBe("@corpus-search");
  });

  it("把 skill 当作原子范围删除、跨越，并随撤销重做恢复语义", async () => {
    const view = await render_composer();
    const editor = get_editor(view);
    await select_skill(view, editor, "glossary-audit");
    const token_length = "@glossary-audit".length;
    const token = view.querySelector<HTMLElement>(".agent-skill-token");

    expect(editor.state.doc.toString()).toBe("@glossary-audit");
    expect(view.querySelector(".cm-cursorLayer")).not.toBeNull();
    expect(token?.getAttribute("contenteditable")).toBe("false");
    if (token === null) throw new Error("缺少能力 token");
    const token_rect = { left: 10, right: 30, top: 2, bottom: 18 } as DOMRect;
    vi.spyOn(token, "getBoundingClientRect").mockReturnValue(token_rect);
    vi.spyOn(token, "getClientRects").mockReturnValue([token_rect] as unknown as DOMRectList);
    expect(editor.coordsAtPos(token_length, -1)?.left).toBe(31);

    await act(async () => {
      editor.dispatch({ selection: EditorSelection.cursor(token_length) });
      cursorCharBackward(editor);
    });
    expect(editor.state.selection.main.head).toBe(0);

    await act(async () => {
      editor.dispatch({ selection: EditorSelection.cursor(token_length) });
      deleteCharBackward(editor);
    });
    expect(editor.state.doc.toString()).toBe("");
    expect(view.querySelector(".agent-skill-token")).toBeNull();

    await act(async () => void undo(editor));
    expect(editor.state.doc.toString()).toBe("@glossary-audit");
    expect(view.querySelector(".agent-skill-token")?.textContent).toBe("@glossary-audit");
    await act(async () => void redo(editor));
    expect(editor.state.doc.toString()).toBe("");

    await act(async () => void undo(editor));
    await act(async () => {
      editor.dispatch({ selection: EditorSelection.cursor(0) });
      deleteCharForward(editor);
    });
    expect(editor.state.doc.toString()).toBe("");
    await act(async () => void undo(editor));
    await act(async () => {
      editor.dispatch({
        changes: { from: 0, to: token_length, insert: "" },
        selection: EditorSelection.cursor(0),
      });
    });
    expect(editor.state.doc.toString()).toBe("");
    await act(async () => void undo(editor));
    expect(view.querySelector(".agent-skill-token")?.textContent).toBe("@glossary-audit");
  });

  it("跨重新挂载恢复结构化草稿，并在 session 受理后清空且可浏览历史", async () => {
    const composer_ref = createRef<AgentComposerHandle>();
    const on_send = vi.fn();
    await render_composer({ composer_ref, on_send });
    await act(async () => {
      composer_ref.current?.write_draft([
        { kind: "text", text: "  检查 " },
        { kind: "skill", name: "glossary-audit" },
        { kind: "text", text: "  " },
      ]);
    });

    await act(async () => root?.unmount());
    root = null;
    const remounted_view = await render_composer({ composer_ref, on_send });
    const remounted_editor = get_editor(remounted_view);
    expect(remounted_editor.state.doc.toString()).toBe("  检查 @glossary-audit  ");
    expect(remounted_view.querySelector(".agent-skill-token")?.textContent).toBe("@glossary-audit");

    await click_send(remounted_view);
    const accepted_parts: AgentUserMessagePart[] = [
      { kind: "text", text: "检查 " },
      { kind: "skill", name: "glossary-audit" },
    ];
    expect(on_send).toHaveBeenCalledWith(accepted_parts);
    expect(remounted_editor.state.doc.toString()).toBe("  检查 @glossary-audit  ");

    const input_session = default_input_session!;
    input_session.accept_message(accepted_parts);
    await render_composer({ composer_ref, on_send, input_session });
    expect(remounted_editor.state.doc.toString()).toBe("");
    await dispatch_key(remounted_editor.contentDOM, "ArrowUp");
    expect(remounted_editor.state.doc.toString()).toBe("检查 @glossary-audit");
    expect(remounted_view.querySelector(".agent-skill-token")?.textContent).toBe("@glossary-audit");
  });

  it("含 skill 的消息只裁剪组合外缘并保留 token 内侧空白", async () => {
    const on_send = vi.fn();
    const view = await render_composer({ on_send });
    const editor = get_editor(view);
    await select_skill(view, editor, "glossary-audit");
    const token_length = editor.state.doc.length;
    await act(async () => {
      editor.dispatch({
        changes: [
          { from: 0, insert: " \n " },
          { from: token_length, insert: " 说明  " },
        ],
      });
    });

    await click_send(view);

    expect(on_send).toHaveBeenCalledWith([
      { kind: "skill", name: "glossary-audit" },
      { kind: "text", text: " 说明" },
    ]);
    expect(editor.state.doc.toString()).toBe(" \n @glossary-audit 说明  ");
  });

  it("Enter 选择菜单项，Shift+Enter 换行", async () => {
    const on_send = vi.fn();
    const view = await render_composer({ on_send });
    const editor = get_editor(view);
    await set_document(editor, "@g", 2);
    await dispatch_key(editor.contentDOM, "Enter");
    expect(editor.state.doc.toString()).toBe("@glossary-audit");
    expect(on_send).not.toHaveBeenCalled();

    await dispatch_key(editor.contentDOM, "Enter", true);
    expect(editor.state.doc.toString()).toBe("@glossary-audit\n");
  });

  it("运行态保持草稿可编辑，只停止当前任务并在结束后恢复发送", async () => {
    const on_send = vi.fn();
    const on_stop = vi.fn(async () => undefined);
    const view = await render_composer({ on_send, running: true, on_stop });
    const editor = get_editor(view);
    const content = editor.contentDOM;

    expect(content.getAttribute("contenteditable")).toBe("true");
    await set_document(editor, "@g", 2);
    await wait_for_element(view, '[role="listbox"]');
    await dispatch_key(content, "Enter");
    expect(editor.state.doc.toString()).toBe("@glossary-audit");

    await dispatch_key(content, "Enter", true);
    expect(editor.state.doc.toString()).toBe("@glossary-audit\n");

    await dispatch_key(content, "Enter");
    expect(on_send).not.toHaveBeenCalled();

    const stop = view.querySelector<HTMLButtonElement>('button[aria-label="停止"]');
    if (stop === null) throw new Error("缺少停止按钮");
    await act(async () => stop.click());
    expect(on_stop).toHaveBeenCalledOnce();

    await render_composer({ on_send, on_stop });

    expect(get_editor(view)).toBe(editor);
    expect(content.getAttribute("contenteditable")).toBe("true");
    expect(editor.state.doc.toString()).toBe("@glossary-audit\n");
    expect(view.querySelector<HTMLButtonElement>('button[aria-label="发送"]')?.disabled).toBe(
      false,
    );
  });

  it("Escape 只关闭菜单并保留查询，继续输入后重新打开", async () => {
    const view = await render_composer();
    const editor = get_editor(view);
    await set_document(editor, "@", 1);
    await wait_for_element(view, '[role="listbox"]');

    await dispatch_key(editor.contentDOM, "Escape");
    expect(view.querySelector('[role="listbox"]')).toBeNull();
    expect(editor.state.doc.toString()).toBe("@");

    await act(async () => {
      editor.dispatch({ changes: { from: 1, insert: "g" }, selection: EditorSelection.cursor(2) });
    });
    expect(await wait_for_element(view, '[role="listbox"]')).not.toBeNull();
  });

  it("IME composing 期间 Enter 不选择 skill 或发送", async () => {
    const on_send = vi.fn();
    const view = await render_composer({ on_send });
    const editor = get_editor(view);
    await set_document(editor, "@g", 2);
    await wait_for_element(view, '[role="listbox"]');

    await dispatch_key(editor.contentDOM, "Enter", false, true);

    expect(editor.state.doc.toString()).toBe("@g");
    expect(view.querySelector(".agent-skill-token")).toBeNull();
    expect(on_send).not.toHaveBeenCalled();
  });

  it("呈现当前模型、操作提示、错误与禁用状态", async () => {
    const view = await render_composer({
      issue: "send",
      model_selection: { updating: true },
    });
    const model_trigger = view.querySelector<HTMLButtonElement>(
      'button[aria-label="选择模型: Agent Model"]',
    );
    const thinking_trigger = view.querySelector<HTMLButtonElement>(
      'button[aria-label="思考等级: 中"]',
    );
    const submit = view.querySelector<HTMLButtonElement>('button[aria-label="发送"]');
    const editor = view.querySelector<HTMLElement>(
      '[contenteditable][aria-label="描述任务，或输入 @ 选择能力 …"]',
    );
    const tooltips = [...view.querySelectorAll('[role="tooltip"]')];

    expect(view.textContent).toContain("Enter 发送 · Shift + Enter 换行");
    expect(view.textContent).toContain("发送失败，草稿已保留。");
    expect(view.querySelector('[role="alert"]')).not.toBeNull();
    expect(model_trigger?.textContent).toBe("Agent Model");
    expect(model_trigger?.disabled).toBe(true);
    expect(thinking_trigger?.textContent).toContain("中");
    expect(thinking_trigger?.disabled).toBe(true);
    expect(editor?.getAttribute("contenteditable")).toBe("true");
    expect(tooltips.map((tooltip) => tooltip.textContent)).toEqual(
      expect.arrayContaining(["选择模型", "思考等级", "发送"]),
    );
    expect(submit?.disabled).toBe(true);
  });

  it.each([
    ["restoring", "正在恢复会话"],
    ["runtime_busy", "其它任务正在运行"],
    ["settling", "正在结束当前任务"],
  ] as const)("%s 时保留草稿编辑并禁用命令，提示对应恢复路径", async (reason, label) => {
    const view = await render_composer({
      unavailable_reason: reason,
      can_reset: true,
    });
    const editor = get_editor(view);
    await set_document(editor, "稍后发送", 4);

    expect(editor.contentDOM.getAttribute("contenteditable")).toBe("true");
    expect(view.querySelector<HTMLButtonElement>(".agent-composer__reset")?.disabled).toBe(true);
    expect(view.querySelector<HTMLButtonElement>(".agent-composer__model-trigger")?.disabled).toBe(
      true,
    );
    expect(
      view.querySelector<HTMLButtonElement>(".agent-composer__thinking-trigger")?.disabled,
    ).toBe(true);
    expect(view.querySelector<HTMLButtonElement>(".agent-composer__submit")?.disabled).toBe(true);
    expect([...view.querySelectorAll('[role="tooltip"]')].at(-1)?.textContent).toBe(label);
  });

  it("底栏常驻显示百分比，并在提示中提供 K 单位详情与阈值状态", async () => {
    const view = await render_composer({
      context_usage: { tokens: 31_488, contextWindow: 288_000, maxTokens: 32_000 },
    });
    const usage = view.querySelector<HTMLElement>(".agent-composer__context-usage");

    expect(usage?.textContent).toBe("10.9%");
    expect(usage?.getAttribute("aria-label")).toBe("上下文 10.9% · 31.5K / 288K");
    expect(usage?.tabIndex).toBe(0);
    expect(usage?.dataset["tone"]).toBe("default");
    expect(
      [...view.querySelectorAll('[role="tooltip"]')].map((tooltip) => tooltip.textContent),
    ).toContain("31.5K / 288K");
    expect(
      [...view.querySelectorAll('[role="tooltip"]')].map((tooltip) => tooltip.textContent),
    ).not.toContain("上下文 10.9% · 31.5K / 288K");

    for (const [tokens, tone] of [
      [224_000, "default"],
      [224_001, "warning"],
      [256_000, "warning"],
    ] as const) {
      await render_composer({
        context_usage: { tokens, contextWindow: 288_000, maxTokens: 32_000 },
      });
      expect(
        view.querySelector<HTMLElement>(".agent-composer__context-usage")?.dataset["tone"],
      ).toBe(tone);
    }
    const warning_usage = view.querySelector<HTMLElement>(".agent-composer__context-usage");
    expect(warning_usage?.getAttribute("aria-label")).toContain("接近上下文上限");
    expect(
      [...view.querySelectorAll('[role="tooltip"]')].map((tooltip) => tooltip.textContent),
    ).toContain("256K / 288K接近上下文上限，将在达到阈值后自动整理历史");

    await render_composer({ context_usage: null });
    expect(view.querySelector(".agent-composer__context-usage")?.textContent).toBe("0.0%");
  });

  it("新任务按钮按会话、重置和提交状态禁用", async () => {
    const on_reset = vi.fn();
    const view = await render_composer({ can_reset: false, on_reset });
    const reset = find_button_by_text(view, "agent_page.action.new_task");
    const model = view.querySelector<HTMLButtonElement>(
      'button[aria-label="选择模型: Agent Model"]',
    );
    expect(reset?.disabled).toBe(true);

    await render_composer({ running: true, can_reset: true, on_reset });
    expect(reset?.disabled).toBe(true);
    await act(async () => reset?.click());
    expect(on_reset).not.toHaveBeenCalled();

    await render_composer({ can_reset: true, command: "reset", on_reset });
    expect(reset?.disabled).toBe(true);
    expect(model?.disabled).toBe(true);
    expect(view.querySelector<HTMLButtonElement>('button[aria-label="发送"]')?.disabled).toBe(true);

    await render_composer({
      can_reset: true,
      command: "send",
      unavailable_reason: "settling",
      on_reset,
    });
    expect(reset?.disabled).toBe(true);
    expect(get_editor(view).contentDOM.getAttribute("contenteditable")).toBe("false");
    expect([...view.querySelectorAll('[role="tooltip"]')].at(-1)?.textContent).toBe(
      "agent_page.action.sending",
    );
    await render_composer({ can_reset: true, on_reset });
    expect(get_editor(view).contentDOM.getAttribute("contenteditable")).toBe("true");
  });

  it("reset 命令前后复用 EditorView，并保留正文与 skill token 草稿", async () => {
    seed_input_history([[{ kind: "text", text: "持久历史" }]]);
    const view = await render_composer();
    const editor = get_editor(view);
    await select_skill(view, editor, "glossary-audit");
    await act(async () => {
      editor.dispatch({ changes: { from: editor.state.doc.length, insert: " 待处理" } });
    });

    await render_composer({ command: "reset" });
    expect(get_editor(view)).toBe(editor);
    expect(editor.contentDOM.getAttribute("contenteditable")).toBe("false");
    expect(editor.state.doc.toString()).toBe("@glossary-audit 待处理");
    expect(view.querySelector(".agent-skill-token")?.textContent).toBe("@glossary-audit");

    await render_composer();
    expect(get_editor(view)).toBe(editor);
    expect(editor.contentDOM.getAttribute("contenteditable")).toBe("true");
    expect(editor.state.doc.toString()).toBe("@glossary-audit 待处理");
    expect(view.querySelector(".agent-skill-token")?.textContent).toBe("@glossary-audit");
    await act(async () => editor.dispatch({ selection: EditorSelection.cursor(0) }));
    await dispatch_key(editor.contentDOM, "ArrowUp");
    expect(editor.state.doc.toString()).toBe("持久历史");
  });

  /** 统一用命名参数重渲染同一个组件实例，避免位置参数隐藏测试意图。 */
  async function render_composer(options: RenderComposerOptions = {}): Promise<HTMLDivElement> {
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
    }
    if (root === null) {
      root = createRoot(container);
    }
    await act(async () => {
      default_input_session ??= create_input_session(window.localStorage);
      root?.render(
        <AgentComposer
          ref={options.composer_ref}
          skills={skills}
          running={options.running ?? false}
          unavailable_reason={options.unavailable_reason ?? null}
          command={options.command ?? null}
          issue={options.issue ?? null}
          can_reset={options.can_reset ?? true}
          context_usage={options.context_usage ?? null}
          model_selection={{
            snapshot: {
              model_selection: { translation: "preset", analysis: "preset", agent: "agent" },
              models: [
                {
                  id: "agent",
                  type: "CUSTOM_OPENAI",
                  name: "Agent Model",
                  agent: { context_window: 288_000, max_output_tokens: 32_000 },
                  thinking_level: "MEDIUM",
                  thinking_configurable: true,
                },
              ],
            },
            loading: false,
            updating: false,
            select_model: vi.fn(async () => undefined),
            update_thinking_level: vi.fn(async () => undefined),
            ...options.model_selection,
          }}
          input_session={options.input_session ?? default_input_session}
          on_send={options.on_send ?? vi.fn()}
          on_stop={options.on_stop ?? vi.fn(async () => undefined)}
          on_reset={options.on_reset ?? vi.fn()}
        />,
      );
    });
    return container;
  }
});

function get_editor(container: HTMLElement): EditorView {
  const content = container.querySelector<HTMLElement>(".cm-content");
  const editor = content === null ? null : EditorView.findFromDOM(content);
  if (editor === null) throw new Error("缺少 CodeMirror 编辑器");
  return editor;
}

function seed_input_history(history: readonly (readonly AgentUserMessagePart[])[]): void {
  window.localStorage.setItem(AGENT_INPUT_HISTORY_STORAGE_KEY, JSON.stringify(history));
}

function create_input_session(storage: Storage): TestAgentInputSession {
  let draft: AgentUserMessagePart[] = [];
  let history = read_agent_input_history(storage);
  const session: TestAgentInputSession = {
    revision: 0,
    read_draft: () => draft,
    write_draft: (parts) => {
      draft = parts.map((part) => ({ ...part }));
    },
    read_history: () => history,
    accept_message: (parts) => {
      history = append_agent_input_history(storage, history, parts);
      draft = [];
      session.revision += 1;
    },
  };
  return session;
}

async function set_document(editor: EditorView, text: string, head: number): Promise<void> {
  await act(async () => {
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: text },
      selection: EditorSelection.cursor(head),
    });
  });
}

async function select_skill(
  container: HTMLElement,
  editor: EditorView,
  name: string,
): Promise<void> {
  await set_document(editor, `@${name.slice(0, 2)}`, name.slice(0, 2).length + 1);
  const option = (await wait_for_element(container, '[role="listbox"]')).querySelector<HTMLElement>(
    `[role="option"]#agent-skill-${name}`,
  );
  if (option === null) throw new Error(`缺少能力选项：${name}`);
  await act(async () => option.click());
}

async function click_send(container: HTMLElement): Promise<void> {
  const button = container.querySelector<HTMLButtonElement>(".agent-composer__submit");
  if (button === null) throw new Error("缺少发送按钮");
  await act(async () => {
    button.click();
    await Promise.resolve();
  });
}

async function wait_for_element(container: HTMLElement, selector: string): Promise<HTMLElement> {
  let element: HTMLElement | null = null;
  await act(async () => {
    await vi.waitFor(() => {
      element = container.querySelector<HTMLElement>(selector);
      expect(element).not.toBeNull();
    });
  });
  if (element === null) throw new Error(`缺少元素：${selector}`);
  return element;
}

function find_button_by_text(container: HTMLElement, text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) => {
    return button.textContent?.includes(text) === true;
  });
}

async function dispatch_key(
  content: HTMLElement,
  key: string,
  shiftKey = false,
  isComposing = false,
): Promise<void> {
  await act(async () => {
    content.focus();
    const event = new KeyboardEvent("keydown", {
      key,
      code: key,
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "isComposing", { value: isComposing });
    content.dispatchEvent(event);
  });
}
