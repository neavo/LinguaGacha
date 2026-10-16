import { Type } from "@earendil-works/pi-ai";
import type { ToolRegistration } from "@earendil-works/pi-durable";

import type { AgentApprovalMode } from "../../../domain/setting";
import type { AgentPendingWriteSummary } from "../../../shared/agent";
import { define_agent_tool, agent_tool_result } from "../tool-definition";
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
}): ToolRegistration {
  return define_agent_tool({
    name: "workspace_apply",
    description: [
      "把工作区 `changes/` 中的变更清单提交到工程。被拒绝的记录列入 `rejected`，其余修改在同一事务中提交，事务失败时全部回滚。",
      "",
      "### 回执",
      "",
      "|`status`|含义|",
      "|---|---|",
      "|`applied`|有实际变化，无拒绝|",
      "|`partial`|有实际变化，有拒绝|",
      "|`rejected`|无实际变化，有拒绝|",
      "|`unchanged`|无实际变化，无拒绝|",
      "",
      "|拒绝原因|含义|",
      "|---|---|",
      "|`invalid_change`|记录不符合对应 `reference` 中的变更格式|",
      "|`fp_mismatch`|对象在快照后已变化|",
      "|`target_missing`|目标对象不存在|",
      "|`merge_conflict`|同批已接受对该对象的删除|",
      "|`dependency_conflict`|依赖的删除未被接受|",
      "",
      "- `destroyed` 为 `true` 时，数据快照和变更清单已清空，`work/**` 保留，下次 `workspace_run` 会重建快照。",
      "- `destroyed` 为 `false` 时变更清单保留，重试前只保留尚未成功的修改。",
    ].join("\n"),
    executionMode: "sequential",
    parameters: Type.Object({}, { additionalProperties: false }),
    execute: async (_params, api, context) => {
      const tool_call_id = api.callId;
      const signal = context.abortSignal;
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
