import npm_package from "npm/package.json";

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
  `- 从 \`@lg/npm\` 导入 \`npm\`，调用应用随附的 npm \`${npm_package.version}\`。参数直接传给 npm，不经过 shell，不能读取 stdin`,
  "- `npm.directory` 是所有工程和对话共用的 npm 工程，重启后保留，改动影响之后的全部任务。命令行工具的文件参数使用绝对路径",
  "- 同一脚本内的调用按调用顺序执行，前一次失败不阻断后续调用",
  "- 包的文档与类型在 `node_modules/<包名>/`，包提供的命令行工具用 `exec --` 调用",
  "- 依赖的安装脚本默认不运行，需要时用 `install-scripts approve <包>` 授权，再 `rebuild <包>`",
  "- `package.json` 损坏时 npm 无法运行，通过 `npm.directory` 读取并修复文件后再调用",
  "- npm 结束后仍在运行的子进程持续到本次脚本结束，随后由宿主回收",
  "",
  "```ts",
  format_npm_typescript_api(),
  "```",
].join("\n");
