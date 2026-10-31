import { Type } from "@earendil-works/pi-ai";
import type { ToolRegistration } from "@earendil-works/pi-durable";
import { define_agent_tool, agent_tool_result } from "../tool-definition";
import { AGENT_WORKSPACE_RUNTIME_POLICY } from "../workspace/runtime/policy";
import type { AgentWorkspacePort } from "../workspace/service";
import { execute_and_refresh_skills } from "./workspace-execution";
import npm_package from "npm/package.json";

/** 固定 npm CLI，命令的其余语义由 npm 拥有。 */
export function create_agent_workspace_exec_tool(options: {
  run: AgentWorkspacePort["run_exec"];
  refresh_skills: () => Promise<unknown>;
}): ToolRegistration {
  return define_agent_tool({
    name: "workspace_exec",
    description: [
      `运行应用随附的 npm \`${npm_package.version}\`，管理工作区脚本的共享依赖，或调用 npm 包提供的命令行工具。处理工程数据和文件使用 \`workspace_run\`。`,
      "",
      "- 工作目录（返回的 `cwd`）是所有工程和对话共用的 npm 工程，重启后保留，改动会影响之后的全部任务。包的文档与类型在其 `node_modules/<包名>/`。",
      "- `workspace_run` 只能导入安装在这个工程的包，安装后在新的调用中导入。全局安装和 `npm exec` 临时包不能导入。`@lg/*` 由应用维护。",
      "- 宿主不是 shell，不展开变量和通配符，不支持管道、重定向和命令串联，Windows 路径可以直接书写。需要 shell 时使用 `npm exec --call` 或包脚本。",
      '- 命令行工具的输入输出使用绝对路径，`work/` 的绝对路径可在 `workspace_run` 中用 `path.resolve("work")` 取得。',
      "- 依赖的安装脚本默认不运行，需要时用 `npm install-scripts approve <包>` 授权，再 `npm rebuild <包>`。原生模块须匹配应用的 Electron ABI。",
      "- npm、安装脚本和命令行工具以当前系统账户直接运行，不构成沙箱，操作范围由用户当前任务决定。",
      `- 时限 ${AGENT_WORKSPACE_RUNTIME_POLICY.nodeTimeoutMs / 1000} 秒，包含环境准备。返回前等待所有子进程结束，不能保留后台进程。`,
      "- `stdout`、`stderr` 的形式与 `workspace_run` 相同。非零退出和超时作为工具错误返回。",
      "- 失败不会回滚，按实际状态用 npm 命令恢复。`workspace_run` 环境准备失败时，可以用本工具修复。",
    ].join("\n"),
    executionMode: "sequential",
    parameters: Type.Object(
      {
        command: Type.String({
          minLength: 1,
          description: "以 `npm` 开头的完整命令行，例如 `npm install exceljs`。",
        }),
      },
      { additionalProperties: false },
    ),
    execute: async (params, _api, context) => {
      const signal = context.abortSignal ?? new AbortController().signal;
      signal.throwIfAborted();
      const execution = await execute_and_refresh_skills(
        () => options.run(params.command, signal),
        options.refresh_skills,
      );
      return agent_tool_result(execution);
    },
  });
}
