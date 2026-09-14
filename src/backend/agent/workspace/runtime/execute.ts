import type { JsonValue } from "../../../../domain/json";
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

type AgentWorkspaceProgram = (ws: AgentWorkspaceRuntimeApi) => Promise<unknown>;

export type AgentWorkspaceRuntimeApi = Readonly<{
  contract: AgentWorkspaceRuntimeContract;
  todo: Readonly<{
    read: () => readonly string[];
    write: (todos: readonly string[]) => void;
  }>;
  tool: Readonly<AgentWorkspaceDataTools & AgentWorkspaceHtmlTools>;
}>;

/** 加载并执行 JS 脚本，统一冻结端口、JSON 投影和失败回包。 */
export async function execute_agent_workspace_script(
  script: string,
  read_port: AgentWorkspaceReadPort,
  initial_todos: readonly string[],
): Promise<AgentWorkspaceRuntimeResponse> {
  try {
    const program = await load_agent_workspace_program(script);
    let todos = normalize_agent_todos(initial_todos);
    const todo = Object.freeze({
      read: (): readonly string[] => Object.freeze([...todos]),
      write: (value: readonly string[]): void => {
        todos = normalize_agent_todos(value);
      },
    });
    const result = await program(create_agent_workspace_runtime_api(read_port, todo));
    const serialized = JSON.stringify(result);
    if (serialized === undefined) {
      return { ok: false, message: "工作区脚本必须显式返回 JSON 结果。" };
    }
    if (Buffer.byteLength(serialized, "utf8") > AGENT_WORKSPACE_RUNTIME_POLICY.resultBytes) {
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

/** data URL 让脚本只存在于当前进程，Node 内置模块通过动态 import 使用。 */
async function load_agent_workspace_program(script: string): Promise<AgentWorkspaceProgram> {
  const source = [
    "export default async function agentWorkspaceProgram(ws) {",
    script,
    "}",
    "//# sourceURL=agent-workspace-program.js",
  ].join("\n");
  const module_url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  const module = (await import(module_url)) as { default: AgentWorkspaceProgram };
  return module.default;
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
        await execute_agent_workspace_data_tool(name as AgentWorkspaceDataToolName, context, args),
    ]),
  ) as AgentWorkspaceDataTools;
  return deep_freeze({
    contract: structuredClone(context.contract),
    todo,
    tool: {
      ...data_tools,
      ...AGENT_WORKSPACE_HTML_TOOLS,
    },
  });
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
