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
    `    /** 设置脚本成功后提交的完整有序 Todo；最多 ${AGENT_TODO_ITEM_LIMIT.toString()} 项，每项为不超过 ${AGENT_TODO_TEXT_LIMIT.toString()} 字符的短行动标签。 */`,
    "    write(todos: readonly string[]): void;",
    "  }>;",
    "  tool: Readonly<WorkspaceHtmlTools & {",
    ...tools,
    "  }>;",
    "}>;",
  ].join("\n");
}

/** 从数据工具注册表生成 System 中唯一的能力路由清单。 */
export function format_agent_workspace_tool_routes(): string {
  return Object.entries(AGENT_WORKSPACE_DATA_TOOLS)
    .map(([name, tool]) => `- ${tool.useWhen}：\`ws.tool.${name}\``)
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
