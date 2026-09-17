import type { TSchema } from "@earendil-works/pi-ai";

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

/** 工具说明和工作区参考共用声明生成器，约束只从原 Schema 读取。 */
export function create_schema_renderer(named_schemas: ReadonlyMap<TSchema, string>) {
  return {
    render: render_schema,
    declarations: () =>
      [
        "/** 对象仅接受声明字段。带索引签名的对象允许额外字段，字段值须符合索引签名类型。 */",
        ...COMMON_TYPES.map(
          ({ name, type, description }) => `/** ${description} */ type ${name} = ${type};`,
        ),
        ...[...named_schemas].map(
          ([schema, name]) => `type ${name} = ${render_schema(schema, schema)};`,
        ),
      ].join("\n"),
  };

  /** 仅展开当前命名类型的定义，其余命名类型使用引用；新增 Schema 结构须同步支持。 */
  function render_schema(schema: TSchema, definition?: TSchema, annotate = true): string {
    const unsupported = Object.keys(schema).find((key) => !SUPPORTED_SCHEMA_KEYS.has(key));
    if (unsupported !== undefined)
      throw new Error(`Unsupported Agent Workspace schema keyword: ${unsupported}`);
    const named = named_schemas.get(schema);
    if (named !== undefined && definition !== schema) return named;
    const comment = annotate ? schema_comment(schema) : "";
    const value = schema as unknown as Record<string, unknown>;
    if ("const" in value) return `${comment}${JSON.stringify(value.const)}`;
    if (Array.isArray(value.anyOf)) {
      if (value.type !== undefined)
        throw new Error("Workspace schema compositions must use explicit complete branches.");
      return `${comment}(${value.anyOf.map((entry: TSchema) => render_schema(entry, definition)).join(" | ")})`;
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
          `${named_schemas.has(property) ? "" : schema_comment(property)}${render_property_name(name)}${required.has(name) ? "" : "?"}: ${render_schema(property, definition, false)}`,
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
// 未支持的约束必须显式失败，避免参考文档静默丢失实际校验条件。
const SUPPORTED_SCHEMA_KEYS = new Set([
  "type",
  "const",
  "anyOf",
  "items",
  "properties",
  "required",
  "additionalProperties",
  "patternProperties",
  "description",
  ...Object.keys(SCHEMA_CONSTRAINTS),
]);

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
