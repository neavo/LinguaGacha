import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";

import type { AgentApprovalMode, AgentPendingWriteSummary } from "../../../shared/agent";
import { agent_tool_result } from "./definition";
import { AGENT_WORKSPACE_CONTRACT } from "../workspace/contract";
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
  ) => Promise<{ auto_revision: number | null }>;
  activate_auto: (mode_revision: number) => void;
};

/** AgentService 持有跨回合 Todo，脚本工具只协调调用前后的不可变快照。 */
export type AgentTodoPort = {
  read: () => string[];
  write: (todos: readonly string[]) => void;
};

/** 参数只描述脚本输入；环境和完整 API 随工具说明公开。 */
const WORKSPACE_SCRIPT_PARAMETERS = Type.Object(
  {
    script: Type.String({
      minLength: 1,
      description: "JavaScript 异步函数体，支持顶层 await，通过显式 return 返回可序列化 JSON。",
    }),
  },
  { additionalProperties: false },
);

/** 运行限制从真实策略生成，声明从工具 Schema 生成。 */
const WORKSPACE_SCRIPT_DESCRIPTION: string = [
  "按需建立或刷新工程快照，在受限 Node.js 进程中执行 JS 脚本，读取事实、计算、维护工作资产和准备变更清单。",
  "",
  "运行环境：",
  "- 宿主注入冻结的 ws 接口。",
  "- 数据工具参数与结果由运行时 Schema 校验。",
  "- 每次调用都是新进程，普通内存变量不跨调用保留，工作数据通过文件交接。",
  "",
  "文件与工作区：",
  "- 当前目录为工作区根，相对路径从该目录解析。",
  "- 可读范围：完整工作区。",
  `- 可写范围：${AGENT_WORKSPACE_RUNTIME_POLICY.writeRoots.map((root) => `${root}/**`).join("、")}。`,
  "- 通过 ws.contract 发现数据集、路径、字段与变更格式，按需编写脚本处理，返回所需数据、准备变更清单。",
  '- 文件读写通过 await import("node:fs") 或 await import("node:fs/promises")，其他逻辑使用 Node 标准 API。',
  "",
  "执行与结果：",
  `- 执行时限：${(AGENT_WORKSPACE_RUNTIME_POLICY.timeoutMs / 1000).toString()} 秒。`,
  `- 返回长度上限：${AGENT_WORKSPACE_RUNTIME_POLICY.resultBytes.toString()} 字节。`,
  "- 返回形式：{ result: 脚本返回值 }。",
  "",
  "失败与恢复：",
  "- 脚本失败、停止或超时后，已完成的文件写入仍保留。",
  "- 确认语法解析失败时，脚本正文尚未执行。",
  "- 执行中失败或阶段不明时，先读取并核验受影响资产，复用完整部分并修复其余部分。",
  "",
  "以下 TypeScript 声明仅用于描述可用 API，执行脚本使用 JavaScript 语法：",
  format_agent_workspace_typescript_api(),
].join("\n");

/** 提交副作用从磁盘契约投影，工具另补调用前准备与回执后的恢复动作。 */
const WORKSPACE_APPLY_DESCRIPTION: string = [
  "将当前工作区内的变更清单应用到项目数据。",
  "",
  "提交规则：",
  `- 提交前确认变更文件只包含本批次要提交的内容，避免旧批次遗留变更被一并提交。`,
  `- ${AGENT_WORKSPACE_CONTRACT.apply.transaction}。`,
  `- ${AGENT_WORKSPACE_CONTRACT.apply.partial_success}。`,
  "",
  "返回回执：",
  `- 字段：${AGENT_WORKSPACE_CONTRACT.apply.result.fields.join("、")}。`,
  `- destroyed：${AGENT_WORKSPACE_CONTRACT.apply.result.destroyed}。`,
  "- 详细状态与拒绝原因见 ws.contract.apply。",
  "",
  "提交后处理：",
  "- 回执 destroyed 为 true 时，先通过 workspace_script 建立新快照。",
].join("\n");

/** apply 消费当前活动工作区中的一个提交批次，身份与对象 fp 由服务持有。 */
const WORKSPACE_APPLY_PARAMETERS = Type.Object({}, { additionalProperties: false });

/** 工作区由单一服务持有，模型接口由脚本与提交批次组成。 */
export function create_agent_workspace_tools(options: {
  workspace: Pick<AgentWorkspacePort, "run_script" | "apply_workspace">;
  todo: AgentTodoPort;
  approval: AgentWorkspaceApprovalPort;
}): ToolDefinition[] {
  return [
    defineTool({
      name: "workspace_script",
      label: "运行工作区脚本",
      description: WORKSPACE_SCRIPT_DESCRIPTION,
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
      description: WORKSPACE_APPLY_DESCRIPTION,
      executionMode: "sequential",
      parameters: WORKSPACE_APPLY_PARAMETERS,
      execute: async (tool_call_id, _params, signal) => {
        signal?.throwIfAborted();
        // 批次成功后请求更新审批模式，用户后续选择由 AgentService 仲裁。
        let auto_revision: number | null = null;
        const result = await options.workspace.apply_workspace(
          options.approval.read_mode() === "auto"
            ? undefined
            : async (summary) => {
                const decision = await options.approval.wait_for_decision(
                  tool_call_id,
                  summary,
                  signal,
                );
                auto_revision = decision.auto_revision;
              },
        );
        if (auto_revision !== null) options.approval.activate_auto(auto_revision);
        return agent_tool_result(result);
      },
    }),
  ];
}
