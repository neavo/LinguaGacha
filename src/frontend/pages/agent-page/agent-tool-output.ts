import type { JsonValue } from "@domain/json";
import type { AppViewerRange } from "@frontend/widgets/app-editor/app-editor-code-mirror";

type AgentToolOutput = {
  text: string;
  ranges: readonly AppViewerRange[];
};

/** 只解释完整 JSON 编码，普通数字字符串与字面量转义保持文本语义。 */
function read_output_value(value: JsonValue): JsonValue {
  while (typeof value === "string") {
    const candidate = value.trimStart();
    if (!/^[{["]/u.test(candidate)) break;
    try {
      value = JSON.parse(candidate) as JsonValue;
    } catch {
      // 普通正文、混合日志与不完整 JSON 都是有效工具输出。
      break;
    }
  }
  return value;
}

/** 每块独立解释 JSON 并补齐行尾，共用一份阅读文档和高亮坐标；原始块由会话保留。 */
export function format_agent_tool_output(contents: readonly string[]): AgentToolOutput {
  const chunks: string[] = [];
  const ranges: AppViewerRange[] = [];
  let length = 0;
  for (const content of contents) {
    const block = format_output_block(content);
    const text = block.text.endsWith("\n") ? block.text : `${block.text}\n`;
    chunks.push(text);
    for (const range of block.ranges) {
      ranges.push({ ...range, start: range.start + length, end: range.end + length });
    }
    length += text.length;
  }
  return { text: chunks.join(""), ranges };
}

/** 单块递归解释完整 JSON，换行统一为编辑器使用的 LF，保证后续高亮偏移准确。 */
function format_output_block(content: string): AgentToolOutput {
  let root: JsonValue;
  try {
    root = JSON.parse(content) as JsonValue;
  } catch {
    return { text: content.replace(/\r\n?/gu, "\n"), ranges: [] };
  }
  root = read_output_value(root);
  if (typeof root === "string") return { text: root.replace(/\r\n?/gu, "\n"), ranges: [] };

  const chunks: string[] = [];
  const ranges: AppViewerRange[] = [];
  let length = 0; // 与 CodeMirror 一致，范围使用 UTF-16 偏移
  /** 按输出顺序记录不重叠范围，编辑器可直接构建装饰集合。 */
  const append = (text: string, kind?: AppViewerRange["kind"]): void => {
    if (kind !== undefined && text.length > 0) {
      ranges.push({ start: length, end: length + text.length, kind });
    }
    chunks.push(text);
    length += text.length;
  };
  /** 结构递归与多行正文共用输出游标，正文中的标点不再作为 JSON 解析。 */
  const write = (raw: JsonValue, depth: number): void => {
    const value = read_output_value(raw);
    const indent = "  ".repeat(depth);
    if (typeof value === "string") {
      if (/[\r\n]/u.test(value)) {
        // 块内增加结构缩进，原有空行、缩进与制表符继续保留。
        append("\n");
        append(
          indent + "  " + value.replace(/\r\n?/gu, "\n").replaceAll("\n", "\n" + indent + "  "),
          "text",
        );
        append("\n" + indent);
      } else {
        append(JSON.stringify(value), "string");
      }
    } else if (value !== null && typeof value === "object") {
      const array = Array.isArray(value);
      const keys = Object.keys(value);
      append(array ? "[" : "{");
      keys.forEach((key, index) => {
        append("\n" + indent + "  ");
        if (!array) {
          append(JSON.stringify(key), "property");
          append(": ");
        }
        write(array ? value[Number(key)]! : value[key]!, depth + 1);
        if (index < keys.length - 1) append(",");
      });
      if (keys.length > 0) append("\n" + indent);
      append(array ? "]" : "}");
    } else {
      append(String(value), typeof value === "number" ? "number" : "keyword");
    }
  };
  write(root, 0);
  return { text: chunks.join(""), ranges };
}
