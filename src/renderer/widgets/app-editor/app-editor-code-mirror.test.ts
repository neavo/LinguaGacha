import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { app_editor_whitespace_extension } from "@/widgets/app-editor/app-editor-code-mirror";

let editor_view: EditorView | null = null;

afterEach(() => {
  editor_view?.destroy();
  editor_view = null;
});

function create_editor(doc: string): HTMLDivElement {
  const parent = document.createElement("div");
  document.body.append(parent);

  editor_view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [app_editor_whitespace_extension],
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
