import { Type } from "@earendil-works/pi-ai";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

import type { AgentApprovalMode } from "../../../domain/setting";
import type { AgentPendingWriteSummary } from "../../../shared/agent";
import { define_agent_tool, agent_tool_result } from "../tool-definition";
import { AGENT_WORKSPACE_CONTRACT } from "./contract";
import type { AgentWorkspacePort } from "../workspace/service";

/** `AgentService` 通过审批端口提供当前模式和用户决定。 */
export type AgentWorkspaceApprovalPort = {
  read_mode: () => AgentApprovalMode;
  wait_for_decision: (
    tool_call_id: string,
    summary: AgentPendingWriteSummary,
    signal: AbortSignal | undefined,
  ) => Promise<void>;
};

/** 按本批审批模式提交准备好的变更，等待审批和服务回执。 */
export function create_agent_workspace_apply_tool(options: {
  workspace: Pick<AgentWorkspacePort, "apply_workspace">;
  approval: AgentWorkspaceApprovalPort;
}): ToolDefinition {
  return define_agent_tool({
    name: "workspace_apply",
    description: [
      "将当前工作区的变更清单提交到工程。",
      "",
      "### 提交前",
      "",
      "- 清除旧批次遗留内容，使变更清单只包含本批次要提交的修改。",
      "- 工具按当前审批模式处理写入请求。需要用户授权时，工具会等待决定。",
      "",
      "### 提交与回执",
      "",
      `- ${AGENT_WORKSPACE_CONTRACT.apply.transaction}。`,
      `- ${AGENT_WORKSPACE_CONTRACT.apply.partial_success}。`,
      "- 根据回执确认哪些对象已提交、哪些被拒绝。",
      `- destroyed：${AGENT_WORKSPACE_CONTRACT.apply.result.destroyed}。`,
      "- 详细状态和拒绝原因见 `ws.contract.apply`。",
      "",
      "### 后续操作",
      "",
      "- `destroyed` 为 `true` 时，先调用 `workspace_run` 建立新快照。",
      "- 核实拒绝原因后，只重新准备尚未成功的修改。",
    ].join("\n"),
    executionMode: "sequential",
    parameters: Type.Object({}, { additionalProperties: false }),
    execute: async (tool_call_id, _params, signal) => {
      signal?.throwIfAborted();
      // 每批开始时确定审批方式，期间修改偏好只影响后续批次。
      const result = await options.workspace.apply_workspace(
        options.approval.read_mode() === "auto"
          ? undefined
          : async (summary) => {
              await options.approval.wait_for_decision(tool_call_id, summary, signal);
            },
      );
      return agent_tool_result(result);
    },
  });
}
