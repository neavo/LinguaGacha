import type { TSchema } from "@earendil-works/pi-ai";

import { AGENT_TODO_ITEM_LIMIT, AGENT_TODO_TEXT_LIMIT } from "../../../../../shared/agent-todo";
import { AGENT_WORKSPACE_CONTRACT_SCHEMA, AGENT_WORKSPACE_ITEM_SCHEMA } from "../../schema";
import { format_agent_workspace_html_tools_typescript_api } from "./html-to-markdown";
import { AGENT_WORKSPACE_DATA_TOOLS } from "./registry";

const NAMED_SCHEMAS = new Map<TSchema, string>([
  [AGENT_WORKSPACE_CONTRACT_SCHEMA, "WorkspaceContract"],
  [AGENT_WORKSPACE_ITEM_SCHEMA, "WorkspaceItem"],
]);

/** 把运行时真实 Schema 投影为模型可直接用于编排的紧凑 TypeScript API。 */
export function format_agent_workspace_typescript_api(): string {
  const aliases = [...NAMED_SCHEMAS].map(
    ([schema, name]) => `type ${name} = ${render_schema(schema, new Set([schema]))};`,
  );
  const tools = Object.entries(AGENT_WORKSPACE_DATA_TOOLS).flatMap(([name, tool]) => [
    `    /** ${tool.description} */`,
    `    ${name}(args: ${render_schema(tool.parameters)}): Promise<${render_schema(tool.result)}>;`,
  ]);
  return [
    ...aliases,
    ...format_agent_workspace_html_tools_typescript_api(),
    "",
    "declare const ws: Readonly<{",
    "  contract: WorkspaceContract;",
    "  todo: Readonly<{",
    "    /** 读取当前有序 Todo。 */",
    "    read(): readonly string[];",
    `    /** 设置脚本成功后提交的完整有序 Todo；最多 ${AGENT_TODO_ITEM_LIMIT.toString()} 项，每项为不超过 ${AGENT_TODO_TEXT_LIMIT.toString()} 字符的短行动标签，首尾空白裁剪后须非空；空数组清空 Todo。 */`,
    "    write(todos: readonly string[]): void;",
    "  }>;",
    "  tool: Readonly<WorkspaceHtmlTools & {",
    ...tools,
    "  }>;",
    "}>;",
  ].join("\n");
}

const SCHEMA_CONSTRAINTS = {
  minimum: "最小值",
  maximum: "最大值",
  minItems: "最少项数",
  maxItems: "最多项数",
  minLength: "最短字符数",
  maxLength: "最长字符数",
  minProperties: "最少字段数",
  pattern: "字符串格式",
  default: "省略时",
  uniqueItems: "元素唯一",
} as const;
const SUPPORTED_SCHEMA_KEYS = new Set([
  "type",
  "const",
  "anyOf",
  "allOf",
  "items",
  "properties",
  "required",
  "additionalProperties",
  "patternProperties",
  "description",
  ...Object.keys(SCHEMA_CONSTRAINTS),
]);

/** 仅渲染项目实际使用的 Schema 子集；新增结构须同时补全模型声明。 */
function render_schema(schema: TSchema, expanding = new Set<TSchema>(), annotate = true): string {
  const unsupported = Object.keys(schema).find((key) => !SUPPORTED_SCHEMA_KEYS.has(key));
  if (unsupported !== undefined)
    throw new Error(`Unsupported Agent Workspace schema keyword: ${unsupported}`);
  const comment = annotate ? schema_comment(schema) : "";
  const named = NAMED_SCHEMAS.get(schema);
  if (named !== undefined && !expanding.has(schema)) return `${comment}${named}`;
  const value = schema as unknown as Record<string, unknown>;
  if ("const" in value) return `${comment}${JSON.stringify(value.const)}`;
  for (const [keyword, operator] of [
    ["anyOf", " | "],
    ["allOf", " & "],
  ] as const) {
    const branches = value[keyword];
    if (Array.isArray(branches)) {
      if (value.type !== undefined)
        throw new Error("Workspace schema compositions must use explicit complete branches.");
      return `${comment}(${branches.map((entry: unknown) => render_schema(entry as TSchema, expanding)).join(operator)})`;
    }
  }
  if (value.type === "string" || value.type === "boolean" || value.type === "null")
    return `${comment}${value.type}`;
  if (value.type === "number" || value.type === "integer") return `${comment}number`;
  if (value.type === "array")
    return `${comment}Array<${render_schema(value.items as TSchema, expanding)}>`;
  if (value.type === "object") {
    const properties = (value.properties ?? {}) as Record<string, TSchema>;
    const required = new Set(Array.isArray(value.required) ? (value.required as string[]) : []);
    const fields = Object.entries(properties).map(
      ([name, property]) =>
        `${schema_comment(property)}${render_property_name(name)}${required.has(name) ? "" : "?"}: ${render_schema(property, expanding, false)}`,
    );
    const pattern = value.patternProperties as Record<string, TSchema> | undefined;
    if (pattern !== undefined) {
      const entries = Object.entries(pattern);
      // Type.Record(Type.String(), ...) 使用唯一的任意字符串键模式。
      if (entries.length !== 1 || entries[0]?.[0] !== "^.*$")
        throw new Error("Unsupported Workspace record key pattern.");
      fields.push(`[key: string]: ${render_schema(entries[0][1], expanding)}`);
    }
    if (value.additionalProperties === true) fields.push("[key: string]: unknown");
    else if (
      typeof value.additionalProperties === "object" &&
      value.additionalProperties !== null
    ) {
      fields.push(
        `[key: string]: ${render_schema(value.additionalProperties as TSchema, expanding)}`,
      );
    }
    return `${comment}${fields.length === 0 ? "Record<string, never>" : `{ ${fields.join("; ")} }`}`;
  }
  throw new Error("Unsupported Agent Workspace schema in model description.");
}

/** 字段语义与无法由 TypeScript 表达的结构约束随声明一起交给模型。 */
function schema_comment(schema: TSchema): string {
  const value = schema as unknown as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof value.description === "string") parts.push(value.description);
  if (value.type === "integer") parts.push("整数");
  for (const [key, label] of Object.entries(SCHEMA_CONSTRAINTS)) {
    if (value[key] !== undefined) parts.push(`${label}: ${JSON.stringify(value[key])}`);
  }
  if (value.additionalProperties === false) parts.push("仅接受声明字段");
  // 转义注释结束符，避免字段说明中的文本改变生成声明的语法。
  return parts.length === 0 ? "" : `/** ${parts.join("；").replaceAll("*/", "*\\/")} */ `;
}

/** 标识符键保持简洁，其余属性名使用 JSON 字符串语法。 */
function render_property_name(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(name) ? name : JSON.stringify(name);
}
