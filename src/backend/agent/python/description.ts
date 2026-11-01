/** 模型可见的公共契约集中于此，私有绑定不属于包导出。 */
export function format_python_typescript_api(): string {
  return `
type PythonInfo = Readonly<{ version: string; executable: string; directory: string }>;
type PythonInstallation = Readonly<{ version: string; executable: string }>;
interface PythonEnvironment {
  ensure(): Promise<void>;
  upgrade(): Promise<void>;
  info(): Promise<PythonInfo>;
  install(requirements: readonly string[]): Promise<void>;
  remove(packages: readonly string[]): Promise<void>;
  run(args: readonly string[]): Promise<void>;
}
interface PythonApi {
  environment(options?: Readonly<{ version?: string }>): PythonEnvironment;
  list(): Promise<readonly PythonInstallation[]>;
}
declare const python: PythonApi;
`.trim();
}

export const PYTHON_DESCRIPTION = [
  "### Python：`@lg/python`",
  "",
  "从 `@lg/python` 导入 `python`。`python.environment()` 同步取得环境句柄，不执行准备，其他方法返回 Promise，必须 await。每个 CPython 次版本共享一个依赖环境，安装/移除影响后续对话。",
  '`environment()` 默认选择 CPython 3.13，也接受 `{ version: "3.14" }` 这样的明确次版本。`env.ensure()` 准备可运行环境，首次缺少资源时下载，已准备资源可离线复用。',
  "`python.list()` 只查询应用管理的已安装解释器。`env.upgrade()` 显式升级所选次版本的补丁并复用健康安装树。`env.info()` 返回当前实际版本，句柄仅在本次 JS 执行内有效。",
  "`env.install`/`env.remove` 先应用非空字符串数组指定的依赖修改，再解析和同步，因此旧依赖不可解析时仍可修正。`env.run` 自动准备环境，再执行 Python argv。失败抛错，stdout/stderr 写入本工具日志。中断的安装树在下次操作时重建，保留依赖声明。",
  "Python 的 cwd 是当前工作区。脚本、结果和材料写入 `work/`，通过文件与 JS 交换数据，工程变更仍由 JS 经 `ws` 准备和提交。子进程和 worker 没有 Python SDK 的运行绑定。",
  "",
  "```typescript",
  format_python_typescript_api(),
  "```",
  "",
  "```javascript",
  'import { python } from "@lg/python";',
  'const env = python.environment({ version: "3.13" });',
  'await env.install(["Pillow", "fonttools"]);',
  'await env.run(["work/process.py", "sources/input.png"]);',
  "console.log(await env.info());",
  "```",
].join("\n");
