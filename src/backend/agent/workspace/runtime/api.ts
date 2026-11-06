import {
  create_workspace_contract,
  type AgentWorkspaceRuntimeContract,
} from "../../tools/contract";
import type { bind_emit_image } from "../../tools/emit-image";
import type { bind_doing } from "../../tools/doing";

export type AgentWorkspaceRuntimeApi = Readonly<{
  contract: AgentWorkspaceRuntimeContract;
  userSkillDirectory: string; // 应用级可写技能根，独立于工程快照
  fontsDirectory: string; // 应用随附字体，只读
  emitImage: ReturnType<typeof bind_emit_image>;
  setDoing: ReturnType<typeof bind_doing>;
}>;

/** 装配已初始化的公开能力，冻结 `ws` 外壳以保护绑定关系。 */
export function create_agent_workspace_runtime_api(
  contract: unknown,
  members: Omit<AgentWorkspaceRuntimeApi, "contract">,
): AgentWorkspaceRuntimeApi {
  return Object.freeze({ ...members, contract: create_workspace_contract(contract) });
}
