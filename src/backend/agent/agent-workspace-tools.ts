import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";

import { AGENT_WORKSPACE_API } from "../../shared/backend-runtime";
import type { AgentApprovalMode, AgentPendingWriteSummary } from "../../shared/agent";
import { agent_tool_result } from "./agent-tool";
import type { AgentWorkspacePort } from "./agent-workspace-service";

/** AgentService 提供的窄审批端口，工作区服务不感知会话或 UI 状态。 */
export type AgentWorkspaceApprovalPort = {
  read_mode: () => AgentApprovalMode;
  wait_for_decision: (
    tool_call_id: string,
    summary: AgentPendingWriteSummary,
    signal: AbortSignal | undefined,
  ) => Promise<{ switch_to_auto: boolean }>;
  finish: (pending_id: string) => void;
  activate_auto: () => void;
};

/** 工具 Schema 展开固定 SDK，workspace.contract 提供当前业务契约。 */
const WORKSPACE_SCRIPT_API_DESCRIPTION = [
  "workspace 固定 SDK：",
  ...Object.entries(AGENT_WORKSPACE_API.members).map(
    ([name, declaration]) => `- ${name}${declaration}`,
  ),
  `目录管理适用于：${Object.values(AGENT_WORKSPACE_API.roots).join("、")}。contract.changes 声明的固定 change 文件采用整体覆盖。`,
  "业务路径、字段、limits、changes、effects、guidance 与 apply 以 workspace.contract 为准。",
].join("\n");
/** 模型提交一次性异步脚本体，宿主提供受控 workspace API。 */
const WORKSPACE_SCRIPT_PARAMETERS = Type.Object(
  {
    script: Type.String({
      minLength: 1,
      description: [
        "脚本：JavaScript 异步函数体；宿主注入 workspace，支持顶层 await 和 return，并以显式返回的可序列化 JSON 作为结果。",
        "编排：同一事实快照内的读取、分页、筛选、关联、去重、聚合和当前提交批次 change 准备在一次脚本中完成。",
        "输出：返回计数、代表证据、未决和下一步判断所需的小型 JSON。",
        "分段：模型开放式判断、用户决定、workspace_apply 后的新事实和执行限制形成脚本边界。",
        "调用：workspace SDK 调用直接解析为声明的 JSON 值。",
        WORKSPACE_SCRIPT_API_DESCRIPTION,
      ].join("\n"),
    }),
  },
  { additionalProperties: false },
);

/** apply 消费当前活动工作区中的一个提交批次，身份与对象 fp 由服务持有。 */
const WORKSPACE_APPLY_PARAMETERS = Type.Object({}, { additionalProperties: false });

/** 工作区由单一服务持有，模型接口由脚本与提交批次组成。 */
export function create_agent_workspace_tools(
  workspace: AgentWorkspacePort,
  approval: AgentWorkspaceApprovalPort,
): ToolDefinition[] {
  return [
    defineTool({
      name: "workspace_script",
      label: "运行工作区脚本",
      description:
        "按需建立或刷新当前工程快照，运行模型提供的 JavaScript 异步脚本并返回 JSON 结果。脚本可调用固定只读查询方法、正式字面匹配并读取快照，也可通过同一文件事务覆盖固定 change 文件或管理 task、scratch；成功保留本次准备，失败只回滚本次运行。",
      executionMode: "sequential",
      parameters: WORKSPACE_SCRIPT_PARAMETERS,
      execute: async (_tool_call_id, params, signal) => {
        // SDK 未提供 signal 时仍传入永不取消的标准信号，服务端口无需处理双态。
        const effective_signal = signal ?? new AbortController().signal;
        effective_signal.throwIfAborted();
        return agent_tool_result({
          result: await workspace.run_script(params.script, effective_signal),
        });
      },
    }),
    defineTool({
      name: "workspace_apply",
      label: "应用工作区",
      description:
        "读取当前提交批次并按对象 fp 与领域规则逐行处理；实际成功对象在一个独立事务中提交，单个对象失败进入 rejected，不阻塞无关对象。回执始终包含 status、applied、rejected、destroyed、revisions；无真实变化返回 unchanged。workspace_apply 是工程写入入口。",
      executionMode: "sequential",
      parameters: WORKSPACE_APPLY_PARAMETERS,
      execute: async (tool_call_id, _params, signal) => {
        signal?.throwIfAborted();
        // 只有手动模式建立 pending；自动模式保持原工具调用直通事务。
        const pending_id: string | null = approval.read_mode() === "manual" ? tool_call_id : null;
        // 只在当前批次批准并成功提交后切换后续批次，拒绝或失败保持手动模式。
        let switch_to_auto = false;
        try {
          const result = await workspace.apply_workspace(
            pending_id === null
              ? undefined
              : async (summary) => {
                  const decision = await approval.wait_for_decision(tool_call_id, summary, signal);
                  switch_to_auto = decision.switch_to_auto;
                },
          );
          if (switch_to_auto) approval.activate_auto();
          return agent_tool_result(result);
        } finally {
          if (pending_id !== null) approval.finish(pending_id);
        }
      },
    }),
  ];
}
