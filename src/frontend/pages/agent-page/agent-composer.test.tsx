import { act } from "react";
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

import { AgentComposer } from "./agent-composer";

vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({ t: (key: string) => key }),
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
    await set_document(editor, "@glossary-audit", "@glossary-audit".length);
    expect(view.querySelector(".agent-skill-token")).toBeNull();

    await click_send(view);
    expect(on_send).toHaveBeenLastCalledWith([{ kind: "text", text: "@glossary-audit" }]);
    expect(editor.state.doc.toString()).toBe("@glossary-audit");

    await click_send(view);
    expect(editor.state.doc.toString()).toBe("");
  });

  it("Enter 选择菜单项，Shift+Enter 换行，运行时切换为停止按钮", async () => {
    const on_send = vi.fn(async () => true);
    const on_stop = vi.fn(async () => undefined);
    const view = await render_composer(on_send, false, on_stop);
    const editor = get_editor(view);
    await set_document(editor, "@g", 2);
    await dispatch_key(editor.contentDOM, "Enter");
    expect(editor.state.doc.toString()).toBe("@glossary-audit");
    expect(on_send).not.toHaveBeenCalled();

    await dispatch_key(editor.contentDOM, "Enter", true);
    expect(editor.state.doc.toString()).toBe("@glossary-audit\n");

    await render_composer(on_send, true, on_stop);
    const stop = view.querySelector<HTMLButtonElement>(".agent-composer__submit");
    if (stop === null) throw new Error("缺少停止按钮");
    await act(async () => stop.click());
    expect(on_stop).toHaveBeenCalledOnce();
  });

  it("运行态立即切换为可聚焦只读 DOM，并在停止后原地恢复编辑", async () => {
    const view = await render_composer(
      vi.fn(async () => true),
      true,
    );
    const content = get_editor(view).contentDOM;

    expect(content.getAttribute("contenteditable")).toBe("false");

    await render_composer(
      vi.fn(async () => true),
      false,
    );

    expect(get_editor(view).contentDOM).toBe(content);
    expect(content.getAttribute("contenteditable")).toBe("true");
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

  async function render_composer(
    on_send = vi.fn(async () => true),
    running = false,
    on_stop = vi.fn(async () => undefined),
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
          error={false}
          on_send={on_send}
          on_stop={on_stop}
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
