import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";

import type { AgentApprovalMode, AgentPendingWriteSummary } from "../../../shared/agent";
import { agent_tool_result } from "./definition";
import { AGENT_WORKSPACE_RUNTIME_POLICY } from "../workspace/runtime/policy";
import { format_agent_workspace_typescript_api } from "../workspace/runtime/tool/api-description";
import type { AgentWorkspacePort } from "../workspace/service";

/** AgentService 提供的窄审批端口，工作区服务不感知会话或 UI 状态。 */
export type AgentWorkspaceApprovalPort = {
  read_mode: () => AgentApprovalMode;
  wait_for_decision: (
    tool_call_id: string,
    summary: AgentPendingWriteSummary,
    signal: AbortSignal | undefined,
  ) => Promise<{ switch_to_auto: boolean }>;
  activate_auto: () => void;
};

/** AgentService 持有跨回合 Todo，脚本工具只协调调用前后的不可变快照。 */
export type AgentTodoPort = {
  read: () => string[];
  write: (todos: readonly string[]) => void;
};

/** 工具 Schema 只说明当前可执行接口；跨步骤编排由 System Prompt 统一规定。 */
const WORKSPACE_SCRIPT_API_DESCRIPTION = [
  `最长 ${(AGENT_WORKSPACE_RUNTIME_POLICY.timeoutMs / 1000).toString()} 秒；显式 return 必须是可序列化 JSON，UTF-8 上限为 ${AGENT_WORKSPACE_RUNTIME_POLICY.resultBytes.toString()} 字节。`,
  format_agent_workspace_typescript_api(),
  "业务路径与字段以 ws.contract 为准。示例：const meta = JSON.parse(await Deno.readTextFile(ws.contract.datasets.project_meta.path)); return { counts: meta.counts };",
].join("\n");
/** 模型提交一次性异步函数体，由受限 Deno 进程执行。 */
const WORKSPACE_SCRIPT_PARAMETERS = Type.Object(
  {
    script: Type.String({
      minLength: 1,
      description: [
        "TypeScript 异步函数体；宿主注入 workspace，支持顶层 await 和显式 return。",
        WORKSPACE_SCRIPT_API_DESCRIPTION,
      ].join("\n"),
    }),
  },
  { additionalProperties: false },
);

/** apply 消费当前活动工作区中的一个提交批次，身份与对象 fp 由服务持有。 */
const WORKSPACE_APPLY_PARAMETERS = Type.Object({}, { additionalProperties: false });

/** 工作区由单一服务持有，模型接口由脚本与提交批次组成。 */
export function create_agent_workspace_tools(options: {
  workspace: AgentWorkspacePort;
  todo: AgentTodoPort;
  approval: AgentWorkspaceApprovalPort;
}): ToolDefinition[] {
  return [
    defineTool({
      name: "workspace_script",
      label: "运行工作区脚本",
      description: "按需建立或刷新工程快照，在受限 Deno TypeScript 进程中处理工作区并返回 JSON。",
      executionMode: "sequential",
      parameters: WORKSPACE_SCRIPT_PARAMETERS,
      execute: async (_tool_call_id, params, signal) => {
        // SDK 未提供 signal 时仍传入永不取消的标准信号，服务端口无需处理双态。
        const effective_signal = signal ?? new AbortController().signal;
        effective_signal.throwIfAborted();
        const execution = await options.workspace.run_script(
          params.script,
          options.todo.read(),
          effective_signal,
        );
        // run_script 的协作者可能在取消后才结算；Todo 只提交仍有效的工具调用结果。
        effective_signal.throwIfAborted();
        const result = agent_tool_result({ result: execution.result });
        options.todo.write(execution.todos);
        return result;
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
        // 只在当前批次批准并成功提交后切换后续批次，拒绝或失败保持手动模式。
        let switch_to_auto = false;
        const result = await options.workspace.apply_workspace(
          options.approval.read_mode() === "auto"
            ? undefined
            : async (summary) => {
                const decision = await options.approval.wait_for_decision(
                  tool_call_id,
                  summary,
                  signal,
                );
                switch_to_auto = decision.switch_to_auto;
              },
        );
        if (switch_to_auto) options.approval.activate_auto();
        return agent_tool_result(result);
      },
    }),
  ];
}
