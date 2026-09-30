import type { TSchema } from "@earendil-works/pi-ai";

/** 工具说明和工作区参考共用声明生成器，约束只从原 Schema 读取。 */
export function create_schema_renderer(named_schemas: ReadonlyMap<TSchema, string>) {
  return {
    render: render_schema,
    declarations: () =>
      [
        "/** 对象仅接受声明字段。带索引签名的对象允许额外字段，字段值须符合索引签名类型。 */",
        ...[...named_schemas].map(
          ([schema, name]) =>
            `${schema_comment(schema)}type ${name} = ${render_schema(schema, schema, false)};`,
        ),
      ].join("\n\n"),
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
    if (Array.isArray(value.enum))
      return `${comment}(${value.enum.map((entry) => JSON.stringify(entry)).join(" | ")})`;
    if ("const" in value) return `${comment}${JSON.stringify(value.const)}`;
    if (Array.isArray(value.anyOf)) {
      if (value.type !== undefined)
        throw new Error("Workspace schema compositions must use explicit complete branches.");
      const branches = value.anyOf.map((entry: TSchema) => render_schema(entry, definition));
      return branches.some((branch: string) => branch.includes("\n"))
        ? `${comment}(\n${branches.map((branch: string) => indent(`| ${branch}`)).join("\n")}\n)`
        : `${comment}(${branches.join(" | ")})`;
    }
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
      return `${comment}${fields.length === 0 ? "Record<string, never>" : `{\n${fields.map((field) => indent(`${field};`)).join("\n")}\n}`}`;
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
  "enum",
  "anyOf",
  "items",
  "properties",
  "required",
  "additionalProperties",
  "patternProperties",
  "description",
  ...Object.keys(SCHEMA_CONSTRAINTS),
]);

/** 说明按句换行，机器约束逐项列出，注释始终放在对应声明上方。 */
function schema_comment(schema: TSchema): string {
  const value = schema as unknown as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof value.description === "string")
    parts.push(
      ...value.description
        .split(/(?<=。)|\r?\n/u)
        .map((part) => part.trim())
        .filter(Boolean),
    );
  if (value.type === "integer") parts.push("整数");
  for (const [key, label] of Object.entries(SCHEMA_CONSTRAINTS)) {
    if (value[key] !== undefined) parts.push(`${label}: ${JSON.stringify(value[key])}`);
  }
  // 转义注释结束符，避免字段说明中的文本改变生成声明的语法。
  const lines = parts.map((part) => part.replaceAll("*/", "*\\/"));
  if (lines.length === 0) return "";
  return lines.length === 1
    ? `/** ${lines[0]} */\n`
    : `/**\n${lines.map((line) => ` * ${line}`).join("\n")}\n */\n`;
}

/** 标识符键保持简洁，其余属性名使用 JSON 字符串语法。 */
function render_property_name(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(name) ? name : JSON.stringify(name);
}

/** 递归结果整体缩进，使字段、嵌套结构和注释共享层级。 */
function indent(value: string): string {
  return value
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}
