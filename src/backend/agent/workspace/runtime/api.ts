import { normalize_agent_todos } from "../../../../shared/agent-todo";
import type { AgentWorkspaceRuntimeContract } from "../schema";
import {
  AGENT_WORKSPACE_DATA_TOOLS,
  execute_agent_workspace_data_tool,
  type AgentWorkspaceDataToolName,
  type AgentWorkspaceDataTools,
} from "./tool/registry";
import {
  create_agent_workspace_data_tool_context,
  type AgentWorkspaceReadPort,
} from "./tool/data-tool";

export type AgentWorkspaceRuntimeApi = Readonly<{
  contract: AgentWorkspaceRuntimeContract;
  todo: Readonly<{
    read: () => readonly string[];
    write: (todos: readonly string[]) => void;
  }>;
  tool: Readonly<AgentWorkspaceDataTools>;
}>;

/** 只投影应用契约；普通 Node API 与 npm 模块由原生运行环境提供。 */
export function create_agent_workspace_runtime_api(
  read_port: AgentWorkspaceReadPort,
  initial_todos: readonly string[],
  write_todos: (todos: string[]) => void,
): AgentWorkspaceRuntimeApi {
  const context = create_agent_workspace_data_tool_context(read_port);
  let todos = normalize_agent_todos(initial_todos); // 当前程序副本，宿主只在执行成功后提交
  const data_tools = Object.fromEntries(
    Object.keys(AGENT_WORKSPACE_DATA_TOOLS).map((name) => [
      name,
      (args: unknown) =>
        execute_agent_workspace_data_tool(name as AgentWorkspaceDataToolName, context, args),
    ]),
  ) as AgentWorkspaceDataTools;
  return deep_freeze({
    contract: structuredClone(context.contract), // 冻结公开接口不能改动借入的数据上下文
    todo: {
      /** 读者只能取得不可变副本。 */
      read: () => Object.freeze([...todos]),
      /** 规范化后发送独立快照，外部数组修改不影响后续读取。 */
      write: (value: readonly string[]) => {
        todos = normalize_agent_todos(value);
        write_todos([...todos]);
      },
    },
    tool: data_tools,
  });
}

/** 冻结共享应用接口，调用者仍可自由组织自己的模块与工作数据。 */
function deep_freeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deep_freeze(child);
  return Object.freeze(value);
}
