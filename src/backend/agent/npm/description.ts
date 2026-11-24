import npm_package from "npm/package.json";
import { NPM_REGISTRIES } from "./runtime";

/** 模型可见的公共契约集中于此，私有绑定不属于包导出。 */
export function format_npm_typescript_api(): string {
  return `
interface NpmApi {
  readonly directory: string; // 共享 npm 工程的绝对路径，也是 npm 的 cwd
  run(args: readonly string[]): Promise<void>; // 执行 npm <args>，输出写入本工具日志，非零退出抛错
}
declare const npm: NpmApi;
`.trim();
}

/** `workspace_run` 描述引入的 `@lg/npm` 使用说明。 */
export const NPM_DESCRIPTION = [
  "### npm：`@lg/npm`",
  "",
  `- **调用方式**：从 \`@lg/npm\` 导入 \`npm\`，执行随附的 npm \`${npm_package.version}\`。参数直接传给 npm，不经过 shell 且不读取 stdin；包提供的 CLI 用 \`exec --\` 调用，文档与类型位于 \`node_modules/<包名>/\`。`,
  "- **共享与排队**：`npm.directory` 是所有工程共用的 npm 工程，重启后保留，改动会影响后续全部任务；命令行工具的文件参数须传绝对路径。同一脚本内按顺序执行（单次失败不阻塞后续），跨脚本的写入操作自动排队。",
  `- **源与安全**：未指定 \`registry\` 时，应用按网络出口地区自动选用官方源或国内镜像 \`${NPM_REGISTRIES.mirror}\`（命令行、环境与 npmrc 设置优先）。依赖的安装脚本默认禁用，确需运行时用 \`install-scripts approve <包>\` 授权后再 \`rebuild <包>\`。`,
  "- **恢复与回收**：`package.json` 损坏时直接读取并修复 `npm.directory` 下的文件再重试；npm 退出后残留的子进程会在本次脚本结束时由宿主统一回收。",
  "",
  "```ts",
  format_npm_typescript_api(),
  "```",
].join("\n");
