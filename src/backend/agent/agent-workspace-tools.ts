import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";

import { agent_tool_result } from "./agent-tool";
import type { AgentWorkspacePort } from "./agent-workspace-service";

/** load 不接受模型重传工程身份或快照选项。 */
const WORKSPACE_LOAD_PARAMETERS = Type.Object({}, { additionalProperties: false });
/** 模型只提交函数体，不接触工作区绝对路径。 */
const WORKSPACE_SCRIPT_PARAMETERS = Type.Object(
  {
    script: Type.String({
      minLength: 1,
      description:
        "异步 JavaScript 函数体；唯一参数 workspace 提供同源 contract 及其 script_api 声明的方法，return 小型 JSON 结果。",
    }),
  },
  { additionalProperties: false },
);

/** apply 始终消费当前活动工作区，不接受模型重传身份或 revision。 */
const WORKSPACE_APPLY_PARAMETERS = Type.Object({}, { additionalProperties: false });

/** 工作区始终保持单一状态拥有者，三个工具只做生命周期与脚本适配。 */
export function create_agent_workspace_tools(workspace: AgentWorkspacePort): ToolDefinition[] {
  return [
    defineTool({
      name: "workspace_load",
      label: "加载工作区",
      description:
        "加载当前工程的完整只读快照、空 change 文件与 scratch 工作记忆目录，并返回语言和数量摘要。加载本身不修改工程；再次调用会以最新工程事实替换旧工作区。",
      executionMode: "sequential",
      parameters: WORKSPACE_LOAD_PARAMETERS,
      execute: async (_tool_call_id, _params, signal) => {
        signal?.throwIfAborted();
        const result = await workspace.load_workspace();
        signal?.throwIfAborted();
        return agent_tool_result(result);
      },
    }),
    defineTool({
      name: "workspace_script",
      label: "运行工作区脚本",
      description:
        "运行模型提供的 JavaScript 并返回 JSON 结果。脚本可编排 contract 声明的只读 recipe 与正式字面匹配，可读取快照、通过文件事务覆盖固定 change 文件，并可在 scratch 保存最小结构化工作记忆；成功保留本次修改，失败只回滚本次运行。",
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
        "在当前具体差异或确定规则已经获得用户授权后，校验非空 change 文件并以一个事务应用到工程；无变化不会写入，任一提交前校验、revision 或领域规则失败都不会部分应用。执行期间不可停止。",
      executionMode: "sequential",
      parameters: WORKSPACE_APPLY_PARAMETERS,
      execute: async (_tool_call_id, _params, signal) => {
        signal?.throwIfAborted();
        const result = await workspace.apply_workspace();
        return agent_tool_result(result);
      },
    }),
  ];
}
