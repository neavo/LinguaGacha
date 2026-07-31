import { act, type ReactNode } from "react";
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
import type { AgentContextUsage } from "@shared/agent";

import { AgentComposer } from "./agent-composer";

vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("@frontend/shadcn/tooltip", () => ({
  Tooltip: (props: { children: ReactNode }) => <>{props.children}</>,
  TooltipTrigger: (props: { children: ReactNode }) => <>{props.children}</>,
  TooltipContent: (props: { children: ReactNode }) => <div role="tooltip">{props.children}</div>,
}));
vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      key === "agent_page.input.placeholder"
        ? "描述任务，或输入 @ 选择能力 …"
        : key === "agent_page.input.hint"
          ? "Enter 发送 · Shift + Enter 换行"
          : key === "agent_page.context_usage"
            ? `上下文 ${params?.["percent"]} · ${params?.["used"]} / ${params?.["total"]}`
            : key === "agent_page.context_usage_warning"
              ? "接近上下文上限，将在达到阈值后自动整理历史"
              : key === "agent_page.action.send"
                ? "发送"
                : key === "agent_page.action.stop"
                  ? "停止"
                  : key === "agent_page.error"
                    ? "请求失败，请重试。"
                    : key,
  }),
}));

const skills = [
  { name: "glossary-audit", description: "审校术语" },
  { name: "corpus-search", description: "检索语料" },
];

describe("AgentComposer", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root !== null) await act(async () => root?.unmount());
    container?.remove();
    container = null;
    root = null;
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

  it("普通粘贴的 @name 保持 text，失败保留草稿，受理后全部清空", async () => {
    const on_send = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const view = await render_composer(on_send);
    const editor = get_editor(view);
    const draft = "  \n@glossary-audit \n ";
    await set_document(editor, draft, draft.length);
    expect(view.querySelector(".agent-skill-token")).toBeNull();

    await click_send(view);
    expect(on_send).toHaveBeenLastCalledWith([{ kind: "text", text: "@glossary-audit" }]);
    expect(editor.state.doc.toString()).toBe(draft);

    await click_send(view);
    expect(editor.state.doc.toString()).toBe("");
  });

  it("含 skill 的消息只裁剪组合外缘并保留 token 内侧空白", async () => {
    const on_send = vi.fn(async () => false);
    const view = await render_composer(on_send);
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
    const on_send = vi.fn(async () => true);
    const view = await render_composer(on_send);
    const editor = get_editor(view);
    await set_document(editor, "@g", 2);
    await dispatch_key(editor.contentDOM, "Enter");
    expect(editor.state.doc.toString()).toBe("@glossary-audit");
    expect(on_send).not.toHaveBeenCalled();

    await dispatch_key(editor.contentDOM, "Enter", true);
    expect(editor.state.doc.toString()).toBe("@glossary-audit\n");
  });

  it("运行态保持草稿可编辑，只停止当前任务并在结束后恢复发送", async () => {
    const on_send = vi.fn(async () => true);
    const on_stop = vi.fn(async () => undefined);
    const view = await render_composer(on_send, true, on_stop);
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

    await render_composer(on_send, false, on_stop);

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
    const on_send = vi.fn(async () => true);
    const view = await render_composer(on_send);
    const editor = get_editor(view);
    await set_document(editor, "@g", 2);
    await wait_for_element(view, '[role="listbox"]');

    await dispatch_key(editor.contentDOM, "Enter", false, true);

    expect(editor.state.doc.toString()).toBe("@g");
    expect(view.querySelector(".agent-skill-token")).toBeNull();
    expect(on_send).not.toHaveBeenCalled();
  });

  it("呈现可访问的输入提示、错误与禁用操作", async () => {
    const view = await render_composer(
      vi.fn(async () => true),
      false,
      vi.fn(async () => undefined),
      { updating: true },
      { error: true },
    );
    const model_trigger = view.querySelector<HTMLButtonElement>(
      'button[aria-label="app.model.selection.label"]',
    );
    const submit = view.querySelector<HTMLButtonElement>('button[aria-label="发送"]');
    const editor = view.querySelector<HTMLElement>(
      '[contenteditable][aria-label="描述任务，或输入 @ 选择能力 …"]',
    );
    const tooltips = [...view.querySelectorAll('[role="tooltip"]')];

    expect(view.textContent).toContain("Enter 发送 · Shift + Enter 换行");
    expect(view.textContent).toContain("请求失败，请重试。");
    expect(model_trigger?.textContent).toContain("Agent Model");
    expect(model_trigger?.disabled).toBe(true);
    expect(editor?.getAttribute("contenteditable")).toBe("true");
    expect(tooltips.map((tooltip) => tooltip.textContent)).toContain("发送");
    expect(submit?.disabled).toBe(true);
  });

  it("底栏常驻显示百分比，并在提示中提供 K 单位详情与阈值状态", async () => {
    const view = await render_composer(
      undefined,
      false,
      undefined,
      {},
      {
        context_usage: { tokens: 31_488, contextWindow: 288_000, maxTokens: 32_000 },
      },
    );
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
      await render_composer(
        undefined,
        false,
        undefined,
        {},
        {
          context_usage: { tokens, contextWindow: 288_000, maxTokens: 32_000 },
        },
      );
      expect(
        view.querySelector<HTMLElement>(".agent-composer__context-usage")?.dataset["tone"],
      ).toBe(tone);
    }
    const warning_usage = view.querySelector<HTMLElement>(".agent-composer__context-usage");
    expect(warning_usage?.getAttribute("aria-label")).toContain("接近上下文上限");
    expect(
      [...view.querySelectorAll('[role="tooltip"]')].map((tooltip) => tooltip.textContent),
    ).toContain("256K / 288K接近上下文上限，将在达到阈值后自动整理历史");

    await render_composer(undefined, false, undefined, {}, { context_usage: null });
    expect(view.querySelector(".agent-composer__context-usage")?.textContent).toBe("0.0%");
  });

  it("新任务按钮按会话、重置和提交状态禁用", async () => {
    const on_reset = vi.fn();
    const view = await render_composer(
      vi.fn(async () => true),
      false,
      vi.fn(async () => undefined),
      {},
      { can_reset: false, on_reset },
    );
    const reset = find_button_by_text(view, "agent_page.action.new_task");
    const model = view.querySelector<HTMLButtonElement>(
      'button[aria-label="app.model.selection.label"]',
    );
    expect(reset?.disabled).toBe(true);

    await render_composer(
      vi.fn(async () => true),
      true,
      vi.fn(async () => undefined),
      {},
      { can_reset: true, on_reset },
    );
    expect(reset?.disabled).toBe(false);
    await act(async () => reset?.click());
    expect(on_reset).toHaveBeenCalledOnce();

    await render_composer(
      vi.fn(async () => true),
      false,
      vi.fn(async () => undefined),
      {},
      { can_reset: true, resetting: true, on_reset },
    );
    expect(reset?.disabled).toBe(true);
    expect(model?.disabled).toBe(true);
    expect(view.querySelector<HTMLButtonElement>('button[aria-label="发送"]')?.disabled).toBe(true);

    let resolve_send!: (accepted: boolean) => void;
    await render_composer(
      vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            resolve_send = resolve;
          }),
      ),
      false,
      vi.fn(async () => undefined),
      {},
      { can_reset: true, on_reset },
    );
    await set_document(get_editor(view), "提交中", 3);
    await act(async () => {
      view.querySelector<HTMLButtonElement>(".agent-composer__submit")?.click();
      await Promise.resolve();
    });
    expect(reset?.disabled).toBe(true);
    expect(get_editor(view).contentDOM.getAttribute("contenteditable")).toBe("false");
    await act(async () => resolve_send(false));
    expect(get_editor(view).contentDOM.getAttribute("contenteditable")).toBe("true");
  });

  it("resetting 前后复用 EditorView，并保留正文与 skill token 草稿", async () => {
    const view = await render_composer();
    const editor = get_editor(view);
    await select_skill(view, editor, "glossary-audit");
    await act(async () => {
      editor.dispatch({ changes: { from: editor.state.doc.length, insert: " 待处理" } });
    });

    await render_composer(
      vi.fn(async () => true),
      false,
      vi.fn(async () => undefined),
      {},
      { resetting: true },
    );
    expect(get_editor(view)).toBe(editor);
    expect(editor.contentDOM.getAttribute("contenteditable")).toBe("false");
    expect(editor.state.doc.toString()).toBe("@glossary-audit 待处理");
    expect(view.querySelector(".agent-skill-token")?.textContent).toBe("@glossary-audit");

    await render_composer();
    expect(get_editor(view)).toBe(editor);
    expect(editor.contentDOM.getAttribute("contenteditable")).toBe("true");
    expect(editor.state.doc.toString()).toBe("@glossary-audit 待处理");
    expect(view.querySelector(".agent-skill-token")?.textContent).toBe("@glossary-audit");
  });

  async function render_composer(
    on_send = vi.fn(async () => true),
    running = false,
    on_stop = vi.fn(async () => undefined),
    model_selection_overrides: { loading?: boolean; updating?: boolean } = {},
    composer_overrides: {
      can_reset?: boolean;
      resetting?: boolean;
      on_reset?: () => void;
      error?: boolean;
      context_usage?: AgentContextUsage | null;
    } = {},
  ): Promise<HTMLDivElement> {
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }
    await act(async () => {
      root?.render(
        <AgentComposer
          skills={skills}
          running={running}
          error={composer_overrides.error ?? false}
          can_reset={composer_overrides.can_reset ?? true}
          resetting={composer_overrides.resetting ?? false}
          context_usage={composer_overrides.context_usage ?? null}
          model_selection={{
            snapshot: {
              model_selection: { translation: "preset", analysis: "preset", agent: "agent" },
              models: [
                {
                  id: "agent",
                  type: "CUSTOM_OPENAI",
                  name: "Agent Model",
                  agent: { context_window: 288_000, max_output_tokens: 32_000 },
                },
              ],
            },
            loading: false,
            updating: false,
            select_model: vi.fn(async () => undefined),
            ...model_selection_overrides,
          }}
          on_send={on_send}
          on_stop={on_stop}
          on_reset={composer_overrides.on_reset ?? vi.fn()}
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
