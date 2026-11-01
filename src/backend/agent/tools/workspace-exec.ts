import { Type } from "@earendil-works/pi-ai";
import type { ToolRegistration } from "@earendil-works/pi-durable";
import { define_agent_tool, agent_tool_result } from "../tool-definition";
import {
  AGENT_WORKSPACE_RUN_ROOT,
  AGENT_WORKSPACE_RUNTIME_POLICY,
} from "../workspace/runtime/policy";
import type { AgentWorkspacePort } from "../workspace/service";
import { execute_and_refresh_skills } from "./workspace-execution";
import npm_package from "npm/package.json";

/** 工作区命令执行入口，可用命令由运行时登记，参数语义归各命令所有。 */
export function create_agent_workspace_exec_tool(options: {
  run: AgentWorkspacePort["run_exec"];
  refresh_skills: () => Promise<unknown>;
}): ToolRegistration {
  return define_agent_tool({
    name: "workspace_exec",
    description: [
      "在工作区执行命令行，管理 npm 依赖或调用命令行工具",
      "",
      "### 工作方式",
      "",
      "- 宿主不是 shell，拆分参数后直接启动命令，不展开变量和通配符，不支持管道、重定向和命令串联，Windows 路径可以直接书写",
      "- 当前工作目录（`cwd`）是所有工程和对话共用的 npm 工程，重启后保留，改动会影响之后的全部任务",
      `- 每次执行的输出由宿主自动保存到工作区 \`${AGENT_WORKSPACE_RUN_ROOT}/\`，返回的文件路径相对于工作区根目录`,
      '- 命令行工具的输入输出使用绝对路径，`work/` 的绝对路径可在 `workspace_run` 中用 `path.resolve("work")` 取得',
      "- 命令、安装脚本和命令行工具以当前系统账户运行，宿主不限制本机文件和进程访问",
      "",
      "### 可用命令",
      "",
      `- \`npm\`：应用随附的 npm \`${npm_package.version}\``,
      "  - `workspace_run` 的第三方包从共享 npm 工程加载，安装后在新的调用中导入",
      "  - 包的文档与类型在其 `node_modules/<包名>/`",
      "  - 包提供的命令行工具用 `npm exec` 调用",
      "  - 依赖的安装脚本默认不运行，需要时用 `npm install-scripts approve <包>` 授权，再 `npm rebuild <包>`",
      "",
      "### 输出",
      "",
      `- 执行时限为 ${AGENT_WORKSPACE_RUNTIME_POLICY.executionTimeoutMs / 1000} 秒，命令退出时结束仍在运行的子进程，不能保留后台进程`,
      `- \`stdout\` 和 \`stderr\` 各自保存为文件。每路不超过 ${AGENT_WORKSPACE_RUNTIME_POLICY.inlineOutputBytes / 1024} KiB 时直接返回完整内容，内容是文本或解析后的 JSON，超额时返回补读提示，按需读取文件`,
      "",
      "|返回字段|含义|",
      "|---|---|",
      "|`cwd`|本次命令的工作目录|",
      "|`exitCode`、`signal`|进程退出码与退出信号|",
      "|`stdout`、`stderr`|`{ path, bytes, content }`，超额时以 `message` 补读提示代替 `content`|",
    ].join("\n"),
    executionMode: "sequential",
    parameters: Type.Object(
      {
        command: Type.String({
          minLength: 1,
          description: "完整命令行，首个词须是可用命令之一，例如 `npm install exceljs`",
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
