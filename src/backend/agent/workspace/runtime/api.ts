import type { WorkspaceHostRequest, WorkspaceHostResult } from "./host-contract";
import type { AgentImageOptions } from "../../../../shared/agent-image";
import type { AgentWorkspaceRuntimeContract } from "../schema";
import { Check } from "typebox/value";
import { AGENT_WORKSPACE_CONTRACT_SCHEMA } from "../schema";

export type AgentWorkspaceRuntimeApi = Readonly<{
  contract: AgentWorkspaceRuntimeContract;
  userSkillDirectory: string; // 应用级可写技能根，独立于工程快照
  emitImage: (path: string, options?: AgentImageOptions) => Promise<void>;
  host: (request: WorkspaceHostRequest, signal?: AbortSignal) => Promise<WorkspaceHostResult>;
}>;

/** 只投影应用契约；普通 Node API 与 npm 模块由原生运行环境提供。 */
export function create_agent_workspace_runtime_api(
  contract: unknown,
  user_skill_directory: string,
  host: AgentWorkspaceRuntimeApi["host"] = async () => {
    throw new Error("Workspace host unavailable.");
  },
  emitImage: AgentWorkspaceRuntimeApi["emitImage"] = async () => {
    throw new Error("Workspace image output unavailable.");
  },
): AgentWorkspaceRuntimeApi {
  if (!Check(AGENT_WORKSPACE_CONTRACT_SCHEMA, contract)) {
    throw new Error("Workspace contract does not match the runtime schema.");
  }
  return deep_freeze({
    userSkillDirectory: user_skill_directory,
    emitImage,
    host,
    contract: structuredClone(contract), // 冻结公开接口不能改动借入的数据上下文
  });
}

/** 冻结共享应用接口，调用者仍可自由组织自己的模块与工作数据。 */
function deep_freeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deep_freeze(child);
  return Object.freeze(value);
}
