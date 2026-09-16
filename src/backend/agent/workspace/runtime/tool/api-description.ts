import { WORKSPACE_HOST_REQUEST_SCHEMA } from "../host-contract";
import type { TSchema } from "@earendil-works/pi-ai";

import { AGENT_TODO_ITEM_LIMIT, AGENT_TODO_TEXT_LIMIT } from "../../../../../shared/agent-todo";
import { AGENT_WORKSPACE_CONTRACT_SCHEMA, AGENT_WORKSPACE_ITEM_SCHEMA } from "../../schema";
import { AGENT_WORKSPACE_DATA_TOOLS } from "./registry";

const NAMED_SCHEMAS = new Map<TSchema, string>([
  [AGENT_WORKSPACE_CONTRACT_SCHEMA, "WorkspaceContract"],
  [AGENT_WORKSPACE_ITEM_SCHEMA, "WorkspaceItem"],
]);

/** 常见标量约束只说明一次；别名保持普通 JS 值类型，实际校验仍由原 Schema 执行。 */
const COMMON_TYPES = [
  {
    name: "NonNegativeInteger",
    type: "number",
    description: "非负整数",
    schema: { type: "integer", minimum: 0 },
  },
  {
    name: "PositiveInteger",
    type: "number",
    description: "正整数",
    schema: { type: "integer", minimum: 1 },
  },
  {
    name: "NonBlankString",
    type: "string",
    description: "包含非空白字符的字符串",
    schema: { type: "string", minLength: 1, pattern: "\\S" },
  },
] as const;

/**
 * 使用 TypeScript 声明紧凑描述参数、联合类型与返回结构，减少模型能力说明的 token 开销。
 * 工作区脚本执行 JavaScript；声明用于能力说明，实际数据校验由运行时 Schema 负责。
 */
export function format_agent_workspace_typescript_api(): string {
  const aliases = [...NAMED_SCHEMAS].map(
    ([schema, name]) => `type ${name} = ${render_schema(schema, schema)};`,
  );
  const tools = Object.entries(AGENT_WORKSPACE_DATA_TOOLS).flatMap(([name, tool]) => [
    `    /** ${tool.description} */`,
    `    ${name}(args: ${render_schema(tool.parameters)}): Promise<${render_schema(tool.result)}>;`,
  ]);
  return [
    "/** 对象参数仅接受声明字段。带索引签名的对象允许额外字段。字段值须符合索引签名的类型。 */",
    ...COMMON_TYPES.map(
      ({ name, type, description }) => `/** ${description} */ type ${name} = ${type};`,
    ),
    ...aliases,
    "",
    "declare const ws: Readonly<{",
    "  contract: WorkspaceContract;",
    "  /** 将工作区图片作为本次工具的视觉输出。后端自动处理格式与尺寸。await 完成后内容已固定，模型在程序成功返回后看到图片。 */",
    "  emitImage(path: string): Promise<void>;",
    `  host(request: ${render_schema(WORKSPACE_HOST_REQUEST_SCHEMA)}, signal?: AbortSignal): Promise<{ path: string } | { output_path: string }>;`,
    "  todo: Readonly<{",
    "    /** 读取当前有序 Todo。 */",
    "    read(): readonly string[];",
    `    /** 设置程序成功后提交的完整有序 Todo。最多 ${AGENT_TODO_ITEM_LIMIT.toString()} 项。每项为不超过 ${AGENT_TODO_TEXT_LIMIT.toString()} 字符的短行动标签。首尾空白裁剪后须非空。空数组清空 Todo。 */`,
    "    write(todos: readonly string[]): void;",
    "  }>;",
    "  tool: Readonly<{",
    ...tools,
    "  }>;",
    "}>;",
  ].join("\n");
}

const SCHEMA_CONSTRAINTS = {
  minimum: "最小值",
  exclusiveMinimum: "大于",
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

/** 仅展开当前命名类型的定义，其余命名类型使用引用；新增 Schema 结构须同步支持。 */
function render_schema(schema: TSchema, definition?: TSchema, annotate = true): string {
  const unsupported = Object.keys(schema).find((key) => !SUPPORTED_SCHEMA_KEYS.has(key));
  if (unsupported !== undefined)
    throw new Error(`Unsupported Agent Workspace schema keyword: ${unsupported}`);
  const named = NAMED_SCHEMAS.get(schema);
  if (named !== undefined && definition !== schema) return named;
  const comment = annotate ? schema_comment(schema) : "";
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
      return `${comment}(${branches.map((entry: unknown) => render_schema(entry as TSchema, definition)).join(operator)})`;
    }
  }
  const common = find_common_type(value);
  if (common !== undefined) return `${comment}${common.name}`;
  if (value.type === "string" || value.type === "boolean" || value.type === "null")
    return `${comment}${value.type}`;
  if (value.type === "number" || value.type === "integer") return `${comment}number`;
  if (value.type === "array")
    return `${comment}Array<${render_schema(value.items as TSchema, definition)}>`;
  if (value.type === "object") {
    const properties = (value.properties ?? {}) as Record<string, TSchema>;
    const required = new Set(Array.isArray(value.required) ? (value.required as string[]) : []);
    const fields = Object.entries(properties).map(
      ([name, property]) =>
        `${NAMED_SCHEMAS.has(property) ? "" : schema_comment(property)}${render_property_name(name)}${required.has(name) ? "" : "?"}: ${render_schema(property, definition, false)}`,
    );
    const pattern = value.patternProperties as Record<string, TSchema> | undefined;
    if (pattern !== undefined) {
      const entries = Object.entries(pattern);
      // Type.Record(Type.String(), ...) 使用唯一的任意字符串键模式。
      if (entries.length !== 1 || entries[0]?.[0] !== "^.*$")
        throw new Error("Unsupported Workspace record key pattern.");
      fields.push(`[key: string]: ${render_schema(entries[0][1], definition)}`);
    }
    if (value.additionalProperties === true) fields.push("[key: string]: unknown");
    else if (
      typeof value.additionalProperties === "object" &&
      value.additionalProperties !== null
    ) {
      fields.push(
        `[key: string]: ${render_schema(value.additionalProperties as TSchema, definition)}`,
      );
    }
    return `${comment}${fields.length === 0 ? "Record<string, never>" : `{ ${fields.join("; ")} }`}`;
  }
  throw new Error("Unsupported Agent Workspace schema in model description.");
}

/** 只匹配当前重复出现的约束组合，其它字段限制仍在使用处显示。 */
function find_common_type(value: Record<string, unknown>) {
  return COMMON_TYPES.find(({ schema }) =>
    Object.entries(schema).every(([key, expected]) => value[key] === expected),
  );
}

/** 保留字段语义和局部约束，已由公共别名表达的部分不再重复。 */
function schema_comment(schema: TSchema): string {
  const value = schema as unknown as Record<string, unknown>;
  const common = find_common_type(value);
  const parts: string[] = [];
  if (typeof value.description === "string")
    parts.push(value.description.replace(/[。；;]+$/u, ""));
  if (value.type === "integer" && common === undefined) parts.push("整数");
  for (const [key, label] of Object.entries(SCHEMA_CONSTRAINTS)) {
    if (common !== undefined && key in common.schema) continue;
    if (value[key] !== undefined) parts.push(`${label}: ${JSON.stringify(value[key])}`);
  }
  // 转义注释结束符，避免字段说明中的文本改变生成声明的语法。
  return parts.length === 0 ? "" : `/** ${parts.join("。").replaceAll("*/", "*\\/")} */ `;
}

/** 标识符键保持简洁，其余属性名使用 JSON 字符串语法。 */
function render_property_name(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(name) ? name : JSON.stringify(name);
}
