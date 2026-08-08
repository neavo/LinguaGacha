import { syntaxTree } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import {
  app_editor_text_mark_field,
  app_editor_whitespace_extension,
  resolve_app_editor_readonly_extensions,
  resolve_app_editor_syntax_extensions,
  set_app_editor_text_marks_effect,
} from "@frontend/widgets/app-editor/app-editor-code-mirror";

let editor_view: EditorView | null = null;

afterEach(() => {
  editor_view?.destroy();
  editor_view = null;
});

function create_editor(doc: string, extensions: Extension[] = []): HTMLDivElement {
  const parent = document.createElement("div");
  document.body.append(parent);

  editor_view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [app_editor_whitespace_extension, ...extensions],
    }),
    parent,
  });

  return parent;
}

describe("app_editor_whitespace_extension", () => {
  it("为半角空格、全角空格和制表符提供独立可视标记且保留原文", () => {
    const source = "a b　c\td";
    const parent = create_editor(source);

    expect(editor_view?.state.doc.toString()).toBe(source);
    expect(parent.querySelector(".cm-highlightSpace")).not.toBeNull();
    expect(parent.querySelector(".cm-highlightFullwidthSpace")?.textContent).toBe("　");
    expect(parent.querySelector(".cm-highlightTab")).not.toBeNull();
  });

  it("文档变更后继续标记新增的全角空格", () => {
    const parent = create_editor("ab");

    editor_view?.dispatch({
      changes: {
        from: 1,
        insert: "　",
      },
    });

    expect(editor_view?.state.doc.toString()).toBe("a　b");
    expect(parent.querySelector(".cm-highlightFullwidthSpace")?.textContent).toBe("　");
  });
});

describe("app text marks", () => {
  it("CodeMirror 标记更新后替换旧的下划线状态", () => {
    const parent = create_editor("Alice Bob", [app_editor_text_mark_field]);

    editor_view?.dispatch({
      effects: set_app_editor_text_marks_effect.of([{ start: 0, end: 5, tone: "success" }]),
    });

    expect(parent.querySelector(".app-text-mark--success")?.textContent).toBe("Alice");

    editor_view?.dispatch({
      effects: set_app_editor_text_marks_effect.of([{ start: 6, end: 9, tone: "warning" }]),
    });

    expect(parent.querySelector(".app-text-mark--success")).toBeNull();
    expect(parent.querySelector(".app-text-mark--warning")?.textContent).toBe("Bob");
  });
});

describe("resolve_app_editor_readonly_extensions", () => {
  it("同时关闭 DOM 编辑并保留键盘聚焦和只读语义", () => {
    const parent = create_editor("Alpha", resolve_app_editor_readonly_extensions(true));
    const content = parent.querySelector(".cm-content");

    expect(content?.getAttribute("contenteditable")).toBe("false");
    expect(content?.getAttribute("tabindex")).toBe("0");
    expect(content?.getAttribute("aria-readonly")).toBe("true");
  });
});

describe("resolve_app_editor_syntax_extensions", () => {
  it("JSON 语法使用正式解析器并保留输入", () => {
    create_editor('{"items":[true,null]}', [resolve_app_editor_syntax_extensions("json")]);

    expect(editor_view?.state.doc.toString()).toBe('{"items":[true,null]}');
    expect(editor_view === null ? null : syntaxTree(editor_view.state).topNode.type.name).toBe(
      "JsonText",
    );
  });
});
