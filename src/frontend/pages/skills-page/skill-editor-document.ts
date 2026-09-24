import { Text } from "@codemirror/state";
import type { AgentSkillDocument } from "@shared/agent-skills";

const METADATA_FIELDS = ["name", "description"] as const;
const METADATA_SEPARATOR = "---";
export const SKILL_EDITOR_HEADER_LINES = METADATA_FIELDS.length + 2;

/** 将两个字符串字段与正文组成编辑视图，后端负责 YAML 转义。 */
export function format_skill_editor_document(document: AgentSkillDocument): string {
  return [
    METADATA_SEPARATOR,
    ...METADATA_FIELDS.map((field) => `${field}: ${document[field]}`),
    METADATA_SEPARATOR,
    document.body,
  ]
    .join("\n")
    .replace(/\r\n?/g, "\n");
}

/** 从当前文档定位可编辑范围，固定头部由格式化入口创建并由编辑事务保护。 */
export function skill_editor_layout(doc: Text) {
  return {
    fields: METADATA_FIELDS.map((field, index) => {
      const line = doc.line(index + 2);
      return { field, start: line.from, from: line.from + `${field}: `.length, to: line.to };
    }),
    body_from: doc.line(SKILL_EDITOR_HEADER_LINES).to + 1,
  };
}

/** 只拆解受约束的编辑视图，字段内容按普通字符串提交，正文空白完整进入保存请求。 */
export function read_skill_editor_document(text: string): AgentSkillDocument {
  const doc = Text.of(text.split("\n"));
  const { fields, body_from } = skill_editor_layout(doc);
  return {
    name: doc.sliceString(fields[0].from, fields[0].to),
    description: doc.sliceString(fields[1].from, fields[1].to),
    body: doc.sliceString(body_from),
  };
}
