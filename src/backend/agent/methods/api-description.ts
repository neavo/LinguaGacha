import type { TSchema } from "@earendil-works/pi-ai";

import { AGENT_WORKSPACE_CONTRACT_SCHEMA, AGENT_WORKSPACE_ITEM_SCHEMA } from "../workspace/schema";
import { AGENT_WORKSPACE_RUNTIME_METHODS } from "./registry";

const NAMED_SCHEMAS = new Map<TSchema, string>([
  [AGENT_WORKSPACE_CONTRACT_SCHEMA, "WorkspaceContract"],
  [AGENT_WORKSPACE_ITEM_SCHEMA, "WorkspaceItem"],
]);

/** 把运行时真实 Schema 投影为模型可直接用于编排的紧凑 TypeScript API。 */
export function format_agent_workspace_typescript_api(): string {
  const aliases = [...NAMED_SCHEMAS].map(
    ([schema, name]) => `type ${name} = ${render_schema(schema, new Set([schema]))};`,
  );
  const methods = Object.entries(AGENT_WORKSPACE_RUNTIME_METHODS).flatMap(([name, method]) => [
    `  /** ${method.description} */`,
    `  ${name}(args: ${render_schema(method.parameters)}): Promise<${render_schema(method.result)}>;`,
  ]);
  return [
    ...aliases,
    "declare const workspace: Readonly<{",
    "  contract: WorkspaceContract;",
    ...methods,
    "}>;",
  ].join("\n");
}

/** 从领域方法注册表生成 System 中唯一的能力路由清单。 */
export function format_agent_workspace_method_routes(): string {
  return Object.entries(AGENT_WORKSPACE_RUNTIME_METHODS)
    .map(([name, method]) => `- ${method.useWhen}：\`workspace.${name}\``)
    .join("\n");
}

/** 将当前使用到的 TypeBox 子集渲染为内联 TypeScript，并复用命名 Schema。 */
function render_schema(schema: TSchema, expanding = new Set<TSchema>()): string {
  const named = NAMED_SCHEMAS.get(schema);
  if (named !== undefined && !expanding.has(schema)) return named;
  const value = schema as unknown as Record<string, unknown>;
  if ("const" in value) return JSON.stringify(value.const);
  if (Array.isArray(value.anyOf)) {
    return value.anyOf
      .map((entry: unknown) => render_schema(entry as TSchema, expanding))
      .join(" | ");
  }
  if (Array.isArray(value.allOf)) {
    return value.allOf
      .map((entry: unknown) => render_schema(entry as TSchema, expanding))
      .join(" & ");
  }
  if (value.type === "string") return "string";
  if (value.type === "number" || value.type === "integer") return "number";
  if (value.type === "boolean") return "boolean";
  if (value.type === "null") return "null";
  if (value.type === "array") {
    const item = render_schema(value.items as TSchema, expanding);
    return `Array<${item}>`;
  }
  if (value.type === "object") {
    if (value.additionalProperties === true) return "Record<string, unknown>";
    if (typeof value.additionalProperties === "object" && value.additionalProperties !== null) {
      return `Record<string, ${render_schema(value.additionalProperties as TSchema, expanding)}>`;
    }
    const pattern = value.patternProperties as Record<string, TSchema> | undefined;
    if (pattern !== undefined) {
      const value = Object.values(pattern)[0];
      return value === undefined
        ? "Record<string, unknown>"
        : `Record<string, ${render_schema(value, expanding)}>`;
    }
    const properties = (value.properties ?? {}) as Record<string, TSchema>;
    const required = new Set(Array.isArray(value.required) ? (value.required as string[]) : []);
    const fields = Object.entries(properties).map(([name, property]) => {
      const marker = required.has(name) ? "" : "?";
      return `${render_property_name(name)}${marker}: ${render_schema(property, expanding)}`;
    });
    return fields.length === 0 ? "Record<string, never>" : `{ ${fields.join("; ")} }`;
  }
  throw new Error("Unsupported Agent Workspace schema in model description.");
}

/** 标识符键保持简洁，其余属性名使用 JSON 字符串语法。 */
function render_property_name(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(name) ? name : JSON.stringify(name);
}
