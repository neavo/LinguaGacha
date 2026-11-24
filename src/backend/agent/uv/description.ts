import app_package from "../../../../package.json";
import { DEFAULT_PYTHON_VERSION, UV_INDEXES } from "./runtime";

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
  `- **调用方式**：从 \`@lg/uv\` 导入 \`uv\`，执行随附的 uv \`${app_package.workspaceRuntimeTools.uv}\`，参数直接传给 uv，不经过 shell 且不读取 stdin；程序以工作区根目录为 \`cwd\`，结果写入文件后由脚本读取。`,
  `- **共享与排队**：\`uv.directory\` 是所有工程共用的 Python 工程（初始声明 CPython ${DEFAULT_PYTHON_VERSION}，缺解释器或依赖时需联网），重启后保留，改动会影响后续全部任务，同一脚本内按顺序执行（单次失败不阻塞后续），跨脚本的写入操作自动排队。`,
  "- **依赖管理**：用 `add` / `remove` 管理依赖、`tree` 查看、`run python <args>` 运行，不要使用 `uv pip`（不写入声明，环境重建后丢失）或 `uv init`（不接受固定 `UV_PROJECT`）。",
  "- **内置运行时**：根脚本首次调用 `uv.run` 时自动将随附 `lg-runtime` 以 editable 方式写入共享工程，同步命令会安装或恢复它，普通脚本可直接 `import lg`（用 `lg.__file__` 查看源码），避免把脚本命名为 `lg.py`。",
  `- **源与恢复**：未传索引参数时，按网络出口地区选用 PyPI 或国内镜像 \`${UV_INDEXES.mirror}\`（工程以 \`--no-config\` 运行，默认源变化后自动更新 \`uv.lock\`），应用只拥有 \`lg-runtime\` 声明，其余归用户管理；配置损坏时修复 \`uv.directory\` 下的 \`pyproject.toml\`。`,
  "",
  "```ts",
  format_uv_typescript_api(),
  "```",
].join("\n");
