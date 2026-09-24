import { act, createRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { undoDepth } from "@codemirror/commands";

import { AppEditor, type AppEditorHandle } from "@frontend/widgets/app-editor/app-editor";

vi.mock("@frontend/app/appearance/appearance-context", () => {
  return {
    useAppearance: () => {
      return {
        resolved_theme: "light",
      };
    },
  };
});

vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params === undefined ? key : `${key}:${Object.values(params).join(",")}`,
  }),
}));

vi.mock("@frontend/shadcn/tooltip", () => ({
  Tooltip: (props: { children: ReactNode }) => <>{props.children}</>,
  TooltipTrigger: (props: { render: ReactNode }) => <>{props.render}</>,
  TooltipContent: (props: { children: ReactNode }) => <>{props.children}</>,
}));

/** 取得真实输入节点，组件未挂载编辑器时直接报告失败。 */
function get_editor_content(container: HTMLElement): HTMLElement {
  const content = container.querySelector<HTMLElement>(".cm-content");
  if (content === null) {
    throw new Error("缺少编辑器内容节点。");
  }

  return content;
}

/** 从聚焦的输入节点发送 Tab，观察编辑器是否接管按键。 */
function dispatch_tab_key(content: HTMLElement): boolean {
  content.focus();
  const event = new KeyboardEvent("keydown", {
    key: "Tab",
    code: "Tab",
    bubbles: true,
    cancelable: true,
  });

  content.dispatchEvent(event);

  return event.defaultPrevented;
}

describe("AppEditor", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root !== null) {
      await act(async () => {
        root?.unmount();
      });
    }

    container?.remove();
    container = null;
    root = null;
  });

  it("文档扩展限制输入，外部替换绕过过滤且不写入撤销历史", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const extensions = EditorState.changeFilter.of(() => false);
    const on_change = vi.fn();
    await act(async () =>
      root?.render(
        <AppEditor
          value="old"
          aria_label="编辑文档"
          read_only={false}
          extensions={extensions}
          on_change={on_change}
        />,
      ),
    );
    const view = EditorView.findFromDOM(container.querySelector(".cm-content")!)!;
    await act(async () => view.dispatch({ changes: { from: 0, insert: "blocked" } }));
    expect(view.state.doc.toString()).toBe("old");
    await act(async () =>
      root?.render(
        <AppEditor
          value="loaded"
          aria_label="编辑文档"
          read_only={false}
          extensions={extensions}
          on_change={on_change}
        />,
      ),
    );
    expect(view.state.doc.toString()).toBe("loaded");
    expect(undoDepth(view.state)).toBe(0);
    expect(on_change).not.toHaveBeenCalled();
  });

  it("字段形态会把外部多行值归一成单行", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <AppEditor variant="field" value={"Alice\r\nBob"} aria_label="原文姓名" read_only />,
      );
    });

    expect(container.querySelector(".cm-content")?.textContent).toBe("Alice Bob");
    expect(container.querySelector(".app-editor__wrap-action")).toBeNull();
  });

  it("只读状态同步 DOM 编辑语义并在切换时保留内容", async () => {
    const editor_ref = createRef<AppEditorHandle>();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <AppEditor ref={editor_ref} value="Alpha" aria_label="切换编辑器" read_only={false} />,
      );
    });

    const content = get_editor_content(container);
    await act(async () => editor_ref.current?.focus());
    expect(document.activeElement).toBe(content);
    expect(content.getAttribute("contenteditable")).toBe("true");

    await act(async () => {
      root?.render(<AppEditor ref={editor_ref} value="Alpha" aria_label="切换编辑器" read_only />);
    });

    expect(content.getAttribute("contenteditable")).toBe("false");
    expect(content.textContent).toBe("Alpha");

    await act(async () => {
      root?.render(
        <AppEditor ref={editor_ref} value="Alpha" aria_label="切换编辑器" read_only={false} />,
      );
    });

    expect(content.getAttribute("contenteditable")).toBe("true");
  });

  it("查看器提供换行控制并保留只读内容", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <AppEditor
          variant="viewer"
          value={'{"name":"Alice Smith"}'}
          syntax="json"
          aria_label="工具输出"
        />,
      );
    });

    const editor = container.querySelector(".app-editor--viewer");
    const content = get_editor_content(container);
    expect(editor?.classList.contains("app-editor--readonly")).toBe(false);
    expect(editor?.classList.contains("app-editor--wrap-lines")).toBe(true);
    expect(content.getAttribute("contenteditable")).toBe("false");
    expect(content.getAttribute("tabindex")).toBe("0");
    expect(container.querySelector(".cm-lineNumbers")).not.toBeNull();
    expect(container.querySelector(".cm-line span")).not.toBeNull();

    const wrap_action = container.querySelector<HTMLButtonElement>(
      'button[aria-label="app.editor.line_wrap_target:工具输出"]',
    );
    expect(wrap_action?.getAttribute("aria-pressed")).toBe("true");
    await act(async () => wrap_action?.click());

    expect(container.querySelector(".app-editor--wrap-lines")).toBeNull();
    expect(wrap_action?.getAttribute("aria-pressed")).toBe("false");
    expect(get_editor_content(container).textContent).toBe('{"name":"Alice Smith"}');
  });

  it("正文切换换行后保留设置与最新内容", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<AppEditor value="Alpha Beta" aria_label="正文编辑器" read_only={false} />);
    });

    expect(container.querySelector(".app-editor--wrap-lines")).not.toBeNull();
    const wrap_action = container.querySelector<HTMLButtonElement>(
      'button[aria-label="app.editor.line_wrap_target:正文编辑器"]',
    );
    await act(async () => wrap_action?.click());

    expect(container.querySelector(".app-editor--wrap-lines")).toBeNull();

    await act(async () => {
      root?.render(<AppEditor value="Gamma Delta" aria_label="正文编辑器" read_only />);
    });

    expect(container.querySelector(".app-editor--wrap-lines")).toBeNull();
    expect(get_editor_content(container).textContent).toBe("Gamma Delta");
  });

  it("查看器同步替换文本与语义范围，选区按新长度裁剪且可以直接读取文本", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(
        <AppEditor
          variant="viewer"
          value={"name\n第一行\n第二行"}
          aria_label="结果"
          ranges={[
            { start: 0, end: 4, kind: "property" },
            { start: 5, end: 12, kind: "text" },
          ]}
        />,
      ),
    );
    const content = get_editor_content(container);
    const view = EditorView.findFromDOM(content)!;
    await act(async () => view.dispatch({ selection: { anchor: 5, head: 12 } }));
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(
      "第一行\n第二行",
    );
    expect(content.querySelector(".cm-viewer-property")?.textContent).toBe("name");
    await act(async () =>
      root?.render(
        <AppEditor
          variant="viewer"
          value="null"
          aria_label="结果"
          ranges={[{ start: 0, end: 4, kind: "keyword" }]}
        />,
      ),
    );
    expect(get_editor_content(container)).toBe(content);
    expect(content.querySelector(".cm-viewer-property")).toBeNull();
    expect(content.querySelector(".cm-viewer-keyword")?.textContent).toBe("null");
    expect(view.state.selection.main.head).toBe(4);
    expect(content.getAttribute("contenteditable")).toBe("false");
  });

  it("响应占位文案更新", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <AppEditor value="" aria_label="JSON 编辑器" placeholder="输入 JSON" read_only={false} />,
      );
    });

    expect(container.querySelector(".cm-placeholder")?.textContent).toBe("输入 JSON");

    await act(async () => {
      root?.render(
        <AppEditor
          value=""
          aria_label="JSON 编辑器"
          placeholder="JSON eingeben"
          read_only={false}
        />,
      );
    });

    expect(container.querySelector(".cm-placeholder")?.textContent).toBe("JSON eingeben");
  });

  it("关闭 Tab 缩进后把 Tab 交回浏览器焦点链路", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <AppEditor
          value="Alpha"
          aria_label="质量规则字段"
          read_only={false}
          indent_with_tab={false}
        />,
      );
    });

    expect(dispatch_tab_key(get_editor_content(container))).toBe(false);
  });

  it("更新 Tab 缩进属性后同步重配键盘映射", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <AppEditor
          value="Alpha"
          aria_label="可重配编辑器"
          read_only={false}
          indent_with_tab={false}
        />,
      );
    });

    expect(dispatch_tab_key(get_editor_content(container))).toBe(false);

    await act(async () => {
      root?.render(
        <AppEditor value="Alpha" aria_label="可重配编辑器" read_only={false} indent_with_tab />,
      );
    });

    expect(dispatch_tab_key(get_editor_content(container))).toBe(true);
  });

  it("编辑器失焦时调用最新的 on_blur", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const first_blur = vi.fn();
    const latest_blur = vi.fn();

    await act(async () => {
      root?.render(
        <AppEditor
          value="Alpha"
          aria_label="自动保存编辑器"
          read_only={false}
          on_blur={first_blur}
        />,
      );
    });
    await act(async () => {
      root?.render(
        <AppEditor
          value="Alpha"
          aria_label="自动保存编辑器"
          read_only={false}
          on_blur={latest_blur}
        />,
      );
    });

    await act(async () => {
      const content = get_editor_content(container!);
      content.focus();
      content.blur();
    });

    expect(first_blur).not.toHaveBeenCalled();
    expect(latest_blur).toHaveBeenCalledTimes(1);
  });
});
