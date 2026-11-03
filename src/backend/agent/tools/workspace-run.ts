import { summarize_images } from "./emit-image";
import { Type } from "@earendil-works/pi-ai";
import type { ToolRegistration } from "@earendil-works/pi-durable";

import { define_agent_tool, agent_tool_result } from "../tool-definition";
import { AGENT_WORKSPACE_CONTRACT } from "./contract";
import { AGENT_WORKSPACE_CHANGE_PATHS, AGENT_WORKSPACE_PATHS } from "../workspace/paths";
import {
  AGENT_WORKSPACE_RUN_ROOT,
  AGENT_WORKSPACE_RUNTIME_POLICY,
  AGENT_WORKSPACE_WORK_ROOT,
} from "../workspace/runtime/policy";
import { format_agent_workspace_typescript_api } from "../workspace/runtime/api-description";
import type { AgentWorkspacePort } from "../workspace/service";
import app_package from "../../../../package.json";
import { PYTHON_DESCRIPTION } from "../python/description";
import { NPM_DESCRIPTION } from "../npm/description";

const { defaultTimeoutSeconds, minTimeoutSeconds, maxTimeoutSeconds } =
  AGENT_WORKSPACE_RUNTIME_POLICY;

/** 执行程序并刷新技能事实，随后投影模型可见的执行记录与图片。 */
export function create_agent_workspace_run_tool(options: {
  run: (
    request: Readonly<{ script: string; timeoutMs: number; callId: string }>, // `callId` 关联界面上的工具条目
    signal: AbortSignal,
  ) => ReturnType<AgentWorkspacePort["run"]>;
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
      "- `@lg/*` 是随应用发布的 SDK，在本工具的脚本及其加载的模块中可用。它们不通过 npm 安装：",
      "  - `@lg/project`：识别待加入工程的来源，用法见 `project-operation` 技能",
      "  - `@lg/project/item-contexts`：`queryItemContexts(items, item_ids)` 查询条目的同文件邻近语境。`items` 传入 `items` 数据集的完整数组或流，保持数据集顺序",
      "  - `@lg/pdf`、`@lg/pdf/mupdf`：PDF 读取、渲染与打印，用法见 `pdf` 技能",
      "  - `@lg/utils/literal-matcher`：应用判定字面命中与规范化文本的规则",
      "  - `@lg/npm`：应用随附的 npm，管理共享 npm 工程与调用包提供的命令行工具",
      "  - `@lg/python`：应用管理的 Python 解释器、依赖与程序执行",
      "- 第三方包从共享 npm 工程加载，缺少的包先用 `@lg/npm` 安装，再在新的调用中导入",
      `- 共享工程初始提供 ${app_package.workspaceRuntimePackages.agent.join("、")}`,
      "",
      NPM_DESCRIPTION,
      "",
      PYTHON_DESCRIPTION,
      "",
      "### 文件与进程",
      "",
      "- 脚本以当前系统账户运行，宿主不限制本机文件和进程访问",
      `- 工作材料写入 \`${AGENT_WORKSPACE_WORK_ROOT}/\`，变更清单写入 \`changes/\`，用户技能写入 \`ws.userSkillDirectory\`，其余工作区内容由宿主维护，只读`,
      "- 可以创建子进程和 worker。它们是标准 Node 环境，没有宿主通道，也不经过上述依赖解析，`ws` 和 `@lg/*` 只在主脚本中使用",
      "",
      "### 输出",
      "",
      "- 程序退出时结束仍在运行的子进程",
      "- 耗时处理定期输出进度，界面会实时显示给用户",
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
      "- 环境准备失败时脚本不会运行。应用 SDK、npm 或启动资源缺失表示应用安装损坏，需要修复应用安装",
      "- 第三方包缺失或共享 npm 工程损坏时，用 `@lg/npm` 恢复",
      "- 程序失败、停止或超时后，已完成的文件写入仍然保留，继续前检查受影响的文件，复用完整内容并修复未完成或损坏的部分",
      "",
      "### 工作区数据",
      "",
      "- `sources/<file_path>`：工程原稿",
      `- \`${AGENT_WORKSPACE_PATHS.sourceIssues}\` 是 \`sources\` 的准备过程遇到的异常项目记录，文件为空表示没有异常，结论依赖原稿完整时先读取该文件`,
      "- `datasets` 都是工程快照，修改写入对应的 `changes` 后由 `workspace_apply` 提交",
      ...Object.entries(AGENT_WORKSPACE_CONTRACT.datasets).map(([name, dataset]) => {
        const operations = Object.keys(AGENT_WORKSPACE_CONTRACT.changes[name] ?? {});
        return `- datasets.${name}：${dataset.purpose}。${operations.length === 0 ? "" : `变更入口 changes.${name}，操作 ${operations.join("、")}。`}参考 ${dataset.reference}`;
      }),
      // 文件变更没有同名数据集，不会出现在上面的数据集列表中。
      `- changes.files：工程文件的新增、改名、移动、排序和删除，操作 ${Object.keys(AGENT_WORKSPACE_CHANGE_PATHS.files).join("、")}。参考 ${AGENT_WORKSPACE_CONTRACT.changes["files"]?.["creates"]?.reference}`,
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
        timeout_seconds: Type.Optional(
          Type.Integer({
            minimum: minTimeoutSeconds,
            maximum: maxTimeoutSeconds,
            description: `执行时限秒数，省略时为 ${defaultTimeoutSeconds}。时限包含执行环境准备及脚本启动的 npm、Python，首次使用 Python 或安装依赖时需调大`,
          }),
        ),
      },
      { additionalProperties: false },
    ),
    execute: async (params, api, context) => {
      const signal = context.abortSignal;
      // SDK 未提供 signal 时仍传入永不取消的标准信号，服务端口无需处理双态。
      const effective_signal = signal ?? new AbortController().signal;
      effective_signal.throwIfAborted();
      const outcome = await options
        .run(
          {
            script: params.script,
            timeoutMs: (params.timeout_seconds ?? defaultTimeoutSeconds) * 1000,
            callId: api.callId,
          },
          effective_signal,
        )
        .then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error }),
        );
      // 失败脚本也可能已写入技能。刷新失败时保留执行主因及完整原因链。
      try {
        await options.refresh_skills();
      } catch (error) {
        if (outcome.ok) throw new Error("Agent skill refresh failed.", { cause: error });
        throw new AggregateError(
          [outcome.error, error],
          "Workspace execution and skill refresh failed.",
          { cause: outcome.error },
        );
      }
      if (!outcome.ok) throw outcome.error;
      const { execution, images } = outcome.value;
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
