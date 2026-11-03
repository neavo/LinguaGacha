import { history, isolateHistory, redo, undo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { EditorState, type Transaction, type TransactionSpec } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { skill_editor_extension } from "./skill-editor-extension";
import { read_skill_editor_document, skill_editor_layout } from "./skill-editor-document";

const original = "---\nname: sample\ndescription: A `value`\n---\n# Body\n";
/** 直接运行 CodeMirror 事务和历史命令，观察编辑结果。 */
function editor() {
  let state = EditorState.create({
    doc: original,
    extensions: [markdown(), history(), skill_editor_extension],
  });
  return {
    /** 向历史命令提供最新状态。 */
    get state() {
      return state;
    },
    /** 接收撤销和重做命令产生的事务。 */
    dispatch(transaction: Transaction) {
      state = transaction.state;
    },
    /** 通过正常事务入口执行场景中的编辑。 */
    change(spec: TransactionSpec) {
      state = state.update(spec).state;
    },
  };
}

describe("技能编辑事务", () => {
  it("字段变长后从当前文档定位，字段与正文共用撤销历史", () => {
    const view = editor();
    const name = skill_editor_layout(view.state.doc).fields[0];
    view.change({
      changes: { from: name.from, to: name.to, insert: "longer-name" },
      annotations: isolateHistory.of("full"),
    });
    const description = skill_editor_layout(view.state.doc).fields[1];
    view.change({
      changes: { from: description.from, to: description.to, insert: "changed" },
      annotations: isolateHistory.of("full"),
    });
    view.change({
      changes: { from: view.state.doc.length, insert: "last" },
      annotations: isolateHistory.of("full"),
    });
    expect(undo(view)).toBe(true);
    expect(read_skill_editor_document(view.state.doc.toString()).body).toBe("# Body\n");
    expect(undo(view)).toBe(true);
    expect(read_skill_editor_document(view.state.doc.toString()).description).toBe("A `value`");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(original);
    expect(redo(view)).toBe(true);
    expect(read_skill_editor_document(view.state.doc.toString()).name).toBe("longer-name");
  });

  it("固定结构拒绝删除、跨区替换和混合修改，跨区选区保持可用", () => {
    const view = editor();
    const { fields, body_from } = skill_editor_layout(view.state.doc);
    view.change({ selection: { anchor: fields[0].from, head: body_from } });
    const selection = view.state.selection;
    for (const changes of [
      { from: 0, to: view.state.doc.length, insert: "replacement" },
      { from: fields[0].from - 1, to: fields[0].from },
      { from: fields[0].to, to: fields[0].to + 1 },
      { from: body_from - 1, to: body_from },
      [
        { from: fields[0].from, insert: "ok" },
        { from: 1, insert: "bad" },
      ],
    ]) {
      view.change({ changes, selection: { anchor: 0 } });
      expect(view.state.doc.toString()).toBe(original);
      expect(view.state.selection.eq(selection)).toBe(true);
    }
    view.change({ selection: { anchor: 0, head: view.state.doc.length } });
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(
      original,
    );
  });

  it("允许清空和重新填写字段，正文起始空行可以增删", () => {
    const view = editor();
    const { from, to } = skill_editor_layout(view.state.doc).fields[0];
    view.change({ changes: { from, to } });
    expect(read_skill_editor_document(view.state.doc.toString()).name).toBe("");
    view.change({ changes: { from, insert: "new" } });
    const { body_from } = skill_editor_layout(view.state.doc);
    view.change({ changes: { from: body_from, insert: "\n\n" } });
    expect(read_skill_editor_document(view.state.doc.toString()).body).toBe("\n\n# Body\n");
    view.change({ changes: { from: body_from, to: body_from + 2 } });
    expect(read_skill_editor_document(view.state.doc.toString()).body).toBe("# Body\n");
  });

  it("元数据粘贴折叠换行并保留光标与单次撤销，正文接受多行", () => {
    const view = editor();
    const { from, to } = skill_editor_layout(view.state.doc).fields[1];
    view.change({
      changes: { from, to, insert: "first\n\nsecond" },
      selection: { anchor: from + "first\n\nsecond".length },
      userEvent: "input.paste",
    });
    expect(read_skill_editor_document(view.state.doc.toString()).description).toBe("first second");
    expect(view.state.selection.main.head).toBe(from + "first second".length);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(original);
    view.change({ changes: { from, insert: "\n" }, userEvent: "input" });
    expect(view.state.doc.toString()).toBe(original);
    const { body_from } = skill_editor_layout(view.state.doc);
    view.change({
      changes: { from: body_from, insert: "first\nsecond\n" },
      userEvent: "input.paste",
    });
    expect(read_skill_editor_document(view.state.doc.toString()).body).toBe(
      "first\nsecond\n# Body\n",
    );
  });

  it("元数据不参与 Markdown 解析，正文从自己的首行开始高亮", () => {
    const view = editor();
    const tree = syntaxTree(view.state);
    expect(tree.toString()).not.toContain("InlineCode");
    expect(tree.topNode.lastChild?.name).toBe("ATXHeading1");
    expect(tree.topNode.lastChild?.from).toBe(skill_editor_layout(view.state.doc).body_from);
  });
});
