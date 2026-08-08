import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";

import { agent_tool_result } from "./agent-tool";
import type { AgentWorkspacePort } from "./agent-workspace-service";

/** create 不接受模型重传工程身份或快照选项。 */
const WORKSPACE_CREATE_PARAMETERS = Type.Object({}, { additionalProperties: false });

/** 模型只提交函数体，不接触工作区绝对路径。 */
const WORKSPACE_RUN_PARAMETERS = Type.Object(
  {
    script: Type.String({
      minLength: 1,
      description:
        "在一次性 Chromium 沙箱中执行的异步 JavaScript 函数体；通过参数 workspace 使用流式文件 API，return 值必须是小型 JSON 摘要。",
    }),
  },
  { additionalProperties: false },
);

/** apply 始终消费当前活动工作区，不接受模型重传身份或 revision。 */
const WORKSPACE_APPLY_PARAMETERS = Type.Object({}, { additionalProperties: false });

/** 工作区始终保持单一状态拥有者，三个工具只做参数适配。 */
export function create_agent_workspace_tools(workspace: AgentWorkspacePort): ToolDefinition[] {
  return [
    defineTool({
      name: "workspace_create",
      label: "创建工作区",
      description:
        "创建当前工程的完整一次性数据工作区；结构与可写字段读取 contract.json，工程数据与派生证据一次生成。创建本身不修改工程，成功创建会替换旧工作区。",
      executionMode: "sequential",
      parameters: WORKSPACE_CREATE_PARAMETERS,
      execute: async (_tool_call_id, _params, signal) => {
        signal?.throwIfAborted();
        const result = await workspace.create_workspace();
        signal?.throwIfAborted();
        return agent_tool_result(result);
      },
    }),
    defineTool({
      name: "workspace_run",
      label: "运行工作区脚本",
      description:
        "在无 Node、无 Shell、无外网的一次性 Chromium 沙箱中执行 JavaScript。优先用 workspace.runRecipe 运行 manifest 声明的只读 recipe，也可用流式文件 API 自由处理数据；只有 contract 声明的 editable 文件与 scratch 可写。脚本失败或停止会废弃工作区。",
      executionMode: "sequential",
      parameters: WORKSPACE_RUN_PARAMETERS,
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
        "自动读取、校验并计算全部 editable 的真实差异，在一个事务内应用 items、四类质量规则和两类提示词；任一数据集、revision 或领域规则失败都不会部分写入。必须在用户明确批准当前工作区方案后调用。",
      executionMode: "sequential",
      parameters: WORKSPACE_APPLY_PARAMETERS,
      execute: async (_tool_call_id, _params, signal) => {
        signal?.throwIfAborted();
        const result = await workspace.apply_workspace();
        signal?.throwIfAborted();
        return agent_tool_result(result);
      },
    }),
  ];
}
