import { is_json_record, type JsonRecord, type JsonValue } from "../../../../domain/json";
import { normalize_agent_todos } from "../../../../shared/agent-todo";
import { AGENT_WORKSPACE_RUNTIME_POLICY } from "./policy";
import type { AgentWorkspaceRuntimeContract } from "../schema";
import {
  AGENT_WORKSPACE_DATA_TOOLS,
  execute_agent_workspace_data_tool,
  type AgentWorkspaceDataToolName,
  type AgentWorkspaceDataTools,
} from "./tool/registry";
import { AGENT_WORKSPACE_HTML_TOOLS, type AgentWorkspaceHtmlTools } from "./tool/html-to-markdown";
import {
  create_agent_workspace_data_tool_context,
  type AgentWorkspaceReadPort,
} from "./tool/data-tool";

export type AgentWorkspaceRuntimeResponse =
  | { ok: true; result: JsonValue; todos: string[] }
  | { ok: false; message: string };

export type AgentWorkspaceProgram = (ws: AgentWorkspaceRuntimeApi) => Promise<unknown>;

export type AgentWorkspaceRuntimeApi = Readonly<{
  contract: AgentWorkspaceRuntimeContract;
  todo: Readonly<{
    read: () => readonly string[];
    write: (todos: readonly string[]) => void;
  }>;
  tool: Readonly<AgentWorkspaceDataTools & AgentWorkspaceHtmlTools>;
}>;

/** 把脚本作为 TypeScript 异步函数体交给 Deno 原生模块加载器转译。 */
export async function execute_agent_workspace_script(
  script: string,
  read_port: AgentWorkspaceReadPort,
  initial_todos: readonly string[],
): Promise<AgentWorkspaceRuntimeResponse> {
  try {
    const program = await load_agent_workspace_program(script);
    return await execute_agent_workspace_program(program, read_port, initial_todos);
  } catch (error) {
    return { ok: false, message: error_message(error) };
  }
}

/** 用已加载程序验证冻结端口、JSON 投影与结果上限；Node 单测无需模拟 Deno 转译器。 */
export async function execute_agent_workspace_program(
  program: AgentWorkspaceProgram,
  read_port: AgentWorkspaceReadPort,
  initial_todos: readonly string[] = [],
): Promise<AgentWorkspaceRuntimeResponse> {
  try {
    let todos = normalize_agent_todos(initial_todos);
    const todo = Object.freeze({
      read: (): readonly string[] => Object.freeze([...todos]),
      write: (value: readonly string[]): void => {
        todos = normalize_agent_todos(value);
      },
    });
    const result = await program(create_agent_workspace_runtime_api(read_port, todo));
    if (result === undefined) {
      return { ok: false, message: "工作区脚本必须显式返回 JSON 结果。" };
    }
    let serialized: string | undefined;
    try {
      serialized = JSON.stringify(result);
    } catch (error) {
      return { ok: false, message: error_message(error) };
    }
    if (serialized === undefined) {
      return { ok: false, message: "工作区脚本必须显式返回 JSON 结果。" };
    }
    if (
      new TextEncoder().encode(serialized).byteLength > AGENT_WORKSPACE_RUNTIME_POLICY.resultBytes
    ) {
      return {
        ok: false,
        message: "脚本返回结果过大；请在工作区内完成聚合并只返回摘要。",
      };
    }
    return { ok: true, result: JSON.parse(serialized) as JsonValue, todos: [...todos] };
  } catch (error) {
    return { ok: false, message: error_message(error) };
  }
}

/** blob URL 保持脚本只存在于当前进程，并交给 Deno 的 TypeScript loader。 */
async function load_agent_workspace_program(script: string): Promise<AgentWorkspaceProgram> {
  const source = [
    "export default async function agentWorkspaceProgram(ws: any) {",
    script,
    "}",
    "//# sourceURL=agent-workspace-program.ts",
  ].join("\n");
  const module_url = URL.createObjectURL(new Blob([source], { type: "application/typescript" }));
  try {
    const module = (await import(module_url)) as { default?: unknown };
    if (typeof module.default !== "function") {
      throw new Error("Agent Workspace TypeScript program is missing its executable entry.");
    }
    return module.default as AgentWorkspaceProgram;
  } finally {
    URL.revokeObjectURL(module_url);
  }
}

/** contract、Todo 与工具树共同投影为脚本唯一全局端口。 */
function create_agent_workspace_runtime_api(
  read_port: AgentWorkspaceReadPort,
  todo: AgentWorkspaceRuntimeApi["todo"],
): AgentWorkspaceRuntimeApi {
  const context = create_agent_workspace_data_tool_context(read_port);
  const data_tools = Object.fromEntries(
    Object.entries(AGENT_WORKSPACE_DATA_TOOLS).map(([name]) => [
      name,
      async (args: unknown) =>
        await execute_agent_workspace_data_tool(
          name as AgentWorkspaceDataToolName,
          context,
          require_data_tool_args(args, name),
        ),
    ]),
  ) as AgentWorkspaceDataTools;
  return deep_freeze({
    contract: deep_freeze(structuredClone(context.contract)),
    todo,
    tool: {
      ...data_tools,
      ...AGENT_WORKSPACE_HTML_TOOLS,
    },
  });
}

/** 领域 Schema 细化前先统一拒绝非对象参数。 */
function require_data_tool_args(value: unknown, name: string): JsonRecord {
  if (!is_json_record(value)) throw new Error(`${name} args must be an object`);
  return value;
}

/** 递归冻结注入对象，避免脚本在单次调用内改写共享契约或工具容器。 */
function deep_freeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deep_freeze(child);
  return Object.freeze(value);
}

/** 空异常正文回退到稳定脚本错误，保留其它可修复信息。 */
function error_message(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.trim() === "" ? "工作区脚本执行失败。" : message;
}
