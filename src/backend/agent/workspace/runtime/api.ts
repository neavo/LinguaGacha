import {
  create_workspace_contract,
  type AgentWorkspaceRuntimeContract,
} from "../../tools/contract";
import type { bind_host } from "../../tools/host";
import type { bind_emit_image } from "../../tools/emit-image";

export type AgentWorkspaceRuntimeApi = Readonly<{
  contract: AgentWorkspaceRuntimeContract;
  userSkillDirectory: string; // 应用级可写技能根，独立于工程快照
  emitImage: ReturnType<typeof bind_emit_image>;
  host: ReturnType<typeof bind_host>;
}>;

/** 装配已初始化的公开能力，冻结 `ws` 外壳以保护绑定关系。 */
export function create_agent_workspace_runtime_api(
  contract: unknown,
  user_skill_directory: string,
  host: AgentWorkspaceRuntimeApi["host"],
  emitImage: AgentWorkspaceRuntimeApi["emitImage"],
): AgentWorkspaceRuntimeApi {
  return Object.freeze({
    userSkillDirectory: user_skill_directory,
    emitImage,
    host,
    contract: create_workspace_contract(contract),
  });
}
