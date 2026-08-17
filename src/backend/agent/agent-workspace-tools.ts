import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";

import { AGENT_WORKSPACE_SCRIPT_API } from "../../shared/backend-runtime";
import { agent_tool_result } from "./agent-tool";
import type { AgentWorkspacePort } from "./agent-workspace-service";

/** load 不接受模型重传工程身份或快照选项。 */
const WORKSPACE_LOAD_PARAMETERS = Type.Object({}, { additionalProperties: false });
/** 固定 SDK 只在工具 Schema 展开一次，磁盘 contract 不复制宿主能力。 */
const WORKSPACE_SCRIPT_API_DESCRIPTION = [
  "workspace 固定 SDK（除此之外没有其他成员）：",
  ...Object.entries(AGENT_WORKSPACE_SCRIPT_API.members).map(
    ([name, declaration]) => `- ${name}${declaration}`,
  ),
  `可自由管理目录：${Object.values(AGENT_WORKSPACE_SCRIPT_API.roots).join("、")}。固定 change 文件只能整体覆盖，不能删除。`,
  "业务路径、字段、limits、changes、effects、guidance 与 apply 从 workspace.contract 读取。",
].join("\n");
/** 模型提交唯一完整入口函数，不接触工作区绝对路径。 */
const WORKSPACE_SCRIPT_PARAMETERS = Type.Object(
  {
    script: Type.String({
      minLength: 1,
      description: [
        "完整 JavaScript 入口函数源码；使用 async function main(workspace) { ... }，由宿主注入 workspace 并调用 main。不要只提交函数体或自行调用 main；main 必须 return 小型 JSON 结果。",
        WORKSPACE_SCRIPT_API_DESCRIPTION,
      ].join("\n"),
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
        "加载当前工程的完整只读快照、空 change 文件与 scratch 目录，并挂载当前 Agent 对话跨快照保留的 task 目录；返回语言和数量摘要。加载本身不修改工程；再次调用会以最新工程事实替换旧快照。",
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
        "运行模型提供的完整 JavaScript 入口函数并返回 JSON 结果。脚本可调用固定只读查询方法、正式字面匹配并读取快照，也可通过同一文件事务覆盖固定 change 文件或自由管理 task、scratch 内容；成功保留本次修改，失败只回滚本次运行。",
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
