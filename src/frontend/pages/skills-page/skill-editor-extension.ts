import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState, Prec, type ChangeSpec, type Extension } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import { validate_agent_skill_document } from "@shared/agent-skills";
import { SKILL_EDITOR_HEADER_LINES, skill_editor_layout } from "./skill-editor-document";

/** 头部是字段编辑视图，独立成块后其中的 Markdown 字符不会参与正文语法解析。 */
const skill_markdown = Prec.high(
  markdown({
    base: markdownLanguage,
    extensions: {
      defineNodes: ["SkillMetadata"],
      parseBlock: [
        {
          name: "SkillMetadata",
          before: "HorizontalRule",
          /** 将固定头部作为普通文本块读取，正文从下一行开始解析。 */
          parse(context) {
            if (context.lineStart !== 0) return false;
            for (let line = 0; line < SKILL_EDITOR_HEADER_LINES; line++) context.nextLine();
            context.addElement(context.elt("SkillMetadata", 0, context.prevLineEnd()));
            return true;
          },
        },
      ],
    },
  }),
);

/** 在事务生效前拒绝跨固定结构的修改，允许选择与复制。 */
const protect_metadata = EditorState.transactionFilter.of((transaction) => {
  if (!transaction.docChanged) return transaction;
  const { fields, body_from } = skill_editor_layout(transaction.startState.doc);
  let rejected = false; // 任一变更越过字段边界时拒绝整批修改。
  const corrections: ChangeSpec[] = []; // 修正位置以本次修改后的文档为准。
  transaction.changes.iterChanges((from, to, next_from, next_to, inserted) => {
    if (from >= body_from) return;
    const field = fields.find((item) => from >= item.from && to <= item.to);
    if (!field) {
      rejected = true;
    } else if (inserted.lines > 1) {
      if (transaction.isUserEvent("input.paste")) {
        corrections.push({
          from: next_from,
          to: next_to,
          insert: inserted.toString().replace(/[\r\n]+/g, " "),
        });
      } else {
        rejected = true;
      }
    }
  });
  if (rejected) return [];
  if (corrections.length === 0) return transaction;
  // CodeMirror 合并顺序修改并映射选区，撤销历史只记录最终文本。
  return [transaction, { changes: corrections, sequential: true }];
});

/** 仅计算固定头部的标记，正文高亮继续交给 Markdown。 */
const metadata_marks = EditorView.decorations.compute(["doc"], (state) => {
  const { fields, body_from } = skill_editor_layout(state.doc);
  const invalid = validate_agent_skill_document({
    name: state.doc.sliceString(fields[0].from, fields[0].to),
    description: state.doc.sliceString(fields[1].from, fields[1].to),
    body: "",
  });
  return Decoration.set(
    [
      Decoration.mark({ class: "cm-skill-separator" }).range(0, state.doc.line(1).to),
      ...fields.flatMap(({ field, start, from }) => [
        Decoration.mark({ class: "cm-skill-key" }).range(start, from),
        ...(invalid === field ? [Decoration.line({ class: "cm-skill-invalid" }).range(start)] : []),
      ]),
      Decoration.mark({ class: "cm-skill-separator" }).range(
        state.doc.line(SKILL_EDITOR_HEADER_LINES).from,
        body_from - 1,
      ),
    ],
    true,
  );
});

/** 字段结构、粘贴与高亮规则集中在当前扩展。 */
export const skill_editor_extension: Extension = [skill_markdown, protect_metadata, metadata_marks];
