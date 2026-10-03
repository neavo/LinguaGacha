import { jsonLanguage } from "@codemirror/lang-json";
import type { AppViewerRange } from "@frontend/widgets/app-editor/app-editor-code-mirror";

type JsonPreview = {
  text: string;
  ranges: AppViewerRange[];
};

const JSON_INDENT = "  ";
const JSON_TOKEN_KINDS: Readonly<Record<string, AppViewerRange["kind"]>> = {
  PropertyName: "property",
  String: "string",
  Number: "number",
  True: "keyword",
  False: "keyword",
  Null: "keyword",
};

/** 只重排语法节点之间的空白，字面量直接取原文，保留大整数、重复键和转义。 */
export function format_agent_json_preview(source: string, format: "json" | "jsonl"): JsonPreview {
  const chunks: string[] = [];
  const ranges: AppViewerRange[] = [];
  let length = 0; // 高亮范围与 CodeMirror 共用 UTF-16 偏移。
  /** 文本和高亮范围共用输出游标，后续记录的坐标包含记录间隔。 */
  const append = (text: string, kind?: AppViewerRange["kind"]): void => {
    if (kind) ranges.push({ start: length, end: length + text.length, kind });
    chunks.push(text);
    length += text.length;
  };
  const records = format === "jsonl" ? source.split(/\r?\n/u) : [source];
  for (const record of records) {
    if (format === "jsonl" && record.trim() === "") continue;
    const tree = jsonLanguage.parser.parse(record);
    if (chunks.length > 0) append("\n\n");
    let depth = 0;
    let previous = "";
    // 错误节点立即终止整份预览，局部排版结果只在所有记录成功后交付。
    tree.iterate({
      enter(node) {
        if (node.type.isError) throw new SyntaxError("Invalid JSON preview content");
        if (node.node.firstChild) return;
        const token = record.slice(node.from, node.to);
        if (token === "}" || token === "]") {
          depth--;
          if (previous !== "{" && previous !== "[") append("\n" + JSON_INDENT.repeat(depth));
        } else if (previous === "{" || previous === "[" || previous === ",") {
          append("\n" + JSON_INDENT.repeat(depth));
        }
        append(token, JSON_TOKEN_KINDS[node.name]);
        if (token === "{" || token === "[") depth++;
        if (token === ":") append(" ");
        previous = token;
      },
    });
  }
  return { text: chunks.join(""), ranges };
}
