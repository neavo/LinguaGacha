/** 模型可见的公共契约集中于此，私有绑定不属于包导出。 */
export function format_python_typescript_api(): string {
  return `
type PythonInfo = Readonly<{ version: string; executable: string; directory: string }>;
type PythonInstallation = Readonly<{ version: string; executable: string }>;
interface PythonEnvironment {
  ensure(): Promise<void>; // 按当前依赖声明准备环境，install、remove、run 会自行准备
  upgrade(): Promise<void>; // 升级所选次版本的补丁
  info(): Promise<PythonInfo>; // 只查询已准备的环境
  install(requirements: readonly string[]): Promise<void>; // 先修改依赖声明再同步，可修正无法解析的旧依赖
  remove(packages: readonly string[]): Promise<void>;
  run(args: readonly string[]): Promise<void>; // 执行 python <args>，输出写入本工具日志
}
interface PythonApi {
  environment(options?: Readonly<{ version?: string }>): PythonEnvironment; // 同步选择次版本，省略时使用应用默认次版本
  list(): Promise<readonly PythonInstallation[]>; // 应用已安装的解释器
}
declare const python: PythonApi;
`.trim();
}

/** `workspace_run` 提供共享环境的入口，具体操作采用下方声明。 */
export const PYTHON_DESCRIPTION = [
  "### Python：`@lg/python`",
  "",
  "- 从 `@lg/python` 导入 `python`。程序以工作区根目录为 `cwd`。程序不能读取 stdin。结果写入文件后由脚本读取",
  "- 每个 CPython 次版本有一个跨工程、跨对话共享的依赖环境。`install`、`remove` 影响后续任务。缺少解释器或依赖时需要联网下载",
  "",
  "```ts",
  format_python_typescript_api(),
  "```",
].join("\n");
