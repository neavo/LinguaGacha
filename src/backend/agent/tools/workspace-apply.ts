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
      "把工作区 `changes/` 中的全部变更清单作为一个批次提交到工程。批次分两种：",
      "",
      "- 内容批次：条目、页面、提示词、质量规则和工程知识。先完成检查，再按审批模式请求审批，实际变化只有工程知识时不请求审批。通过检查的记录在同一事务中提交，被拒绝的记录列入 `rejected`。事务失败时全部回滚。",
      "- 文件批次：`changes/files/` 中有任何记录时按文件批次处理，无法解析的行也算。文件批次不能包含其他变更。任一记录被拒绝时，整批都不提交。",
      "",
      "### 回执",
      "",
      "|`status`|含义|",
      "|---|---|",
      "|`applied`|有实际变化，无拒绝|",
      "|`partial`|内容批次有实际变化，也有拒绝|",
      "|`rejected`|无实际变化，有拒绝|",
      "|`unchanged`|内容批次无实际变化，无拒绝|",
      "",
      "`applied` 按对象类型汇总实际生效的变化。文件批次的 `applied.files.created` 按新增记录汇总 `files`、`items`、`pages` 和继承填充数 `inherited`，其中 `renamed` 只列出名称与来源不同的资产，`parse_failed` 列出原稿已保存但文本解析失败的资产。",
      "`created` 的 `contested: number[][]` 仅列出票选继承存在多种旧译文的条目组。组内条目的 `src` 与可见 `name_src` 相同。无争议时为空数组。",
      "回执不附候选译文。按组内 ID 读取最新条目与上下文，判断是否需要修正。需要修正时，通过条目更新另行提交。",
      "",
      "|拒绝原因|含义|",
      "|---|---|",
      "|`invalid_change`|记录不符合对应 `reference` 中的结构或约束，或文件批次混入了其他变更|",
      "|`fp_mismatch`|对象在快照后已变化。文件批次中指工程文件清单已变化|",
      "|`target_missing`|目标对象不存在|",
      "|`merge_conflict`|同批记录对同一对象重复或冲突|",
      "|`dependency_conflict`|依赖的删除未被接受|",
      "|`source_failed`|新增来源识别或准备失败|",
      "",
      "### 恢复",
      "",
      "- `destroyed` 为 `true` 时，数据快照和变更清单已清空，`work/**` 保留。下次 `workspace_run` 会重建快照，继续前基于新快照重新准备变更。",
      "- `destroyed` 为 `false` 时变更清单保留。内容批次重试前只保留尚未成功的记录，文件批次按拒绝原因修正后重提整批。",
      "- `directory_changes` 列出来源准备已改动的目录，出现在回执或错误的 `public_details.source_operation` 中。工程未提交时，这些目录也已经改变。",
      "- 错误码 `data.committed_sync_failed` 表示工程已提交，后续同步失败。文件批次的 `source_operation.saved_assets` 给出已保存的新增资产数。先用 `workspace_run` 核对当前工程，不直接重提原批次。",
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
