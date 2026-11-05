import app_package from "../../../../package.json";
import { DEFAULT_PYTHON_VERSION } from "./runtime";

/** 模型可见的公共契约集中于此，私有绑定不属于包导出。 */
export function format_uv_typescript_api(): string {
  return `
interface UvApi {
  readonly directory: string; // 共享 Python 工程的绝对路径，由 UV_PROJECT 固定
  run(args: readonly string[]): Promise<void>; // 执行 uv <args>，输出写入本工具日志，非零退出抛错
}
declare const uv: UvApi;
`.trim();
}

/** `workspace_run` 描述引入的 `@lg/uv` 使用说明。 */
export const UV_DESCRIPTION = [
  "### Python：`@lg/uv`",
  "",
  `- 从 \`@lg/uv\` 导入 \`uv\`，调用应用随附的 uv \`${app_package.workspaceRuntimeTools.uv}\`。参数直接传给 uv，不经过 shell，不能读取 stdin。程序以工作区根目录为 \`cwd\``,
  `- \`uv.directory\` 是所有工程和对话共用的 Python 工程，重启后保留，改动影响之后的全部任务。初始声明要求 CPython ${DEFAULT_PYTHON_VERSION}，缺少解释器或依赖时需要联网下载`,
  "- 依赖用 `add`、`remove` 管理，查看用 `tree`，程序用 `run python <args>` 执行。`uv pip` 不作用于共享工程，装入的包不进入依赖声明，环境重建后丢失",
  "- 程序结果写入文件后由脚本读取。声明损坏或缺失时，修复 `uv.directory` 下的 `pyproject.toml`。`uv init` 不接受固定的 `UV_PROJECT`",
  "- 同一脚本内的调用按调用顺序执行，前一次失败不阻断后续调用",
  "",
  "```ts",
  format_uv_typescript_api(),
  "```",
].join("\n");
