import { execute_and_refresh_skills } from "./workspace-execution";
import { summarize_images } from "./emit-image";
import { Type } from "@earendil-works/pi-ai";
import type { ToolRegistration } from "@earendil-works/pi-durable";

import { define_agent_tool, agent_tool_result } from "../tool-definition";
import { AGENT_WORKSPACE_CONTRACT } from "./contract";
import { AGENT_WORKSPACE_PATHS } from "../workspace/paths";
import {
  AGENT_WORKSPACE_RUN_ROOT,
  AGENT_WORKSPACE_RUNTIME_POLICY,
  AGENT_WORKSPACE_WORK_ROOT,
} from "../workspace/runtime/policy";
import { format_agent_workspace_typescript_api } from "../workspace/runtime/api-description";
import type { AgentWorkspacePort } from "../workspace/service";
import app_package from "../../../../package.json";
import { PYTHON_DESCRIPTION } from "../python/description";

/** 执行程序并刷新技能事实，随后投影模型可见的执行记录与图片。 */
export function create_agent_workspace_run_tool(options: {
  run: (script: string, signal: AbortSignal) => ReturnType<AgentWorkspacePort["run"]>;
  refresh_skills: () => Promise<unknown>;
}): ToolRegistration {
  return define_agent_tool({
    name: "workspace_run",
    description: [
      "在工程工作区运行脚本，读取工程数据、处理文件和准备变更清单，执行前自动刷新过期的工程快照",
      "",
      "### 工作方式",
      "",
      "- 每次调用启动独立 Node.js 进程，跨调用的数据通过文件交接",
      `- 每次执行的脚本与输出由宿主自动保存到 \`${AGENT_WORKSPACE_RUN_ROOT}/\`，脚本内的相对 \`import\` 从这里解析`,
      "- 当前工作目录（`cwd`）是工作区根目录，文件相对路径从这里解析",
      "",
      "### 依赖",
      "",
      "- 第三方包从 `workspace_exec` 管理的共享 npm 工程加载，缺少的包先安装，再在新的调用中导入",
      "- `@lg/*` 是随应用更新的 SDK，在本工具及其加载的模块中可用：",
      "  - `@lg/pdf` 提供与正式输出共用的 PDF 读取、渲染和生成，接口只交换字节",
      "  - `@lg/text` 提供与应用共用的字面匹配能力",
      "  - `@lg/python` 提供应用管理的 Python 解释器、依赖与程序执行",
      "  - `@lg/workspace/item-contexts` 提供 `queryItemContexts`，用于取得条目的邻近语境",
      `- 共享工程初始提供 ${app_package.workspaceRuntimePackages.agent.join("、")}`,
      "",
      PYTHON_DESCRIPTION,
      "",
      "### 文件与进程",
      "",
      "- 脚本以当前系统账户运行，宿主不限制本机文件和进程访问",
      `- 工作材料写入 \`${AGENT_WORKSPACE_WORK_ROOT}/\`，变更清单写入 \`changes/\`，用户技能写入 \`ws.userSkillDirectory\`，其余工作区内容由宿主维护，只读`,
      "- 可以创建子进程和 worker，它们是标准 Node 环境，不提供 `ws`，也不经过上述依赖解析",
      "",
      "### 输出",
      "",
      `- 环境准备与脚本共用执行时限为 ${AGENT_WORKSPACE_RUNTIME_POLICY.executionTimeoutMs / 1000} 秒，程序在事件循环空闲时自然退出，退出时结束仍在运行的子进程，不能保留后台进程`,
      "- 使用 `console.log` 输出结果",
      `- \`stdout\` 和 \`stderr\` 各自保存为文件。每路不超过 ${AGENT_WORKSPACE_RUNTIME_POLICY.inlineOutputBytes / 1024} KiB 时直接返回完整内容，内容是文本或解析后的 JSON，超额时返回补读提示，按需读取文件`,
      "",
      "|返回字段|含义|",
      "|---|---|",
      "|`scriptPath`|本次脚本的工作区相对路径|",
      "|`exitCode`、`signal`|进程退出码与退出信号|",
      "|`stdout`、`stderr`|`{ path, bytes, content }`，超额时以 `message` 补读提示代替 `content`|",
      "|`images`|`emitImage` 输出的图片信息|",
      "",
      "### 失败与恢复",
      "",
      "- 程序失败或超时会携带执行记录，根据记录定位失败原因",
      "- 环境准备失败时脚本不会运行。用户依赖问题通过 `workspace_exec` 恢复。应用 SDK 或启动资源缺失表示应用安装损坏，需要修复应用安装",
      "- 程序失败、停止或超时后，已完成的文件写入仍然保留，继续前检查受影响的文件，复用完整内容并修复未完成或损坏的部分",
      "",
      "### 工作区数据",
      "",
      "- `sources/<file_path>`：工程原稿，只读",
      `- \`${AGENT_WORKSPACE_PATHS.sourceIssues}\` 是 \`sources\` 的准备过程遇到的异常项目记录，只读，文件为空表示没有异常，结论依赖原稿完整时先读取该文件`,
      "- `datasets` 都是只读快照，修改写入对应的 `changes` 后由 `workspace_apply` 提交",
      ...Object.entries(AGENT_WORKSPACE_CONTRACT.datasets).map(([name, dataset]) => {
        const operations = Object.keys(AGENT_WORKSPACE_CONTRACT.changes[name] ?? {});
        return `- datasets.${name}：${dataset.purpose}。${operations.length === 0 ? "" : `变更入口 changes.${name}，操作 ${operations.join("、")}。`}参考 ${dataset.reference}`;
      }),
      "",
      "### `ws` 接口",
      "",
      "以下 TypeScript 声明仅用于描述接口，脚本请使用 JavaScript 编写：",
      "",
      "```ts",
      format_agent_workspace_typescript_api(),
      "```",
      "",
      "通过 `ws.contract` 查阅参考文档并读取数据集：",
      "",
      "```js",
      'import { readFile } from "node:fs/promises";',
      "",
      'console.log(await readFile(ws.contract.changes.items.updates.reference, "utf8"));',
      "const path = ws.contract.datasets.project_meta.path;",
      'const meta = JSON.parse(await readFile(path, "utf8"));',
      "console.log(JSON.stringify(meta, null, 2));",
      "```",
    ].join("\n"),
    executionMode: "sequential",
    parameters: Type.Object(
      {
        script: Type.String({
          minLength: 1,
          description: "要执行的完整 JavaScript ESM 源码，可使用顶层 `await`，全局 `ws` 无需导入",
        }),
      },
      { additionalProperties: false },
    ),
    execute: async (params, _api, context) => {
      const signal = context.abortSignal;
      // SDK 未提供 signal 时仍传入永不取消的标准信号，服务端口无需处理双态。
      const effective_signal = signal ?? new AbortController().signal;
      effective_signal.throwIfAborted();
      const { execution, images } = await execute_and_refresh_skills(
        () => options.run(params.script, effective_signal),
        options.refresh_skills,
      );
      const result = agent_tool_result({
        ...execution,
        ...(images.length === 0
          ? {}
          : {
              images: summarize_images(images),
            }),
      });
      return {
        ...result,
        output: [
          ...result.output,
          ...images.map(({ image }) => ({
            type: "image" as const,
            mimeType: image.mimeType,
            data: image.data,
          })),
        ],
      };
    },
  });
}
