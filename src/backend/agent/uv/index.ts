import path from "node:path";
import { default_native_fs as fs } from "../../../native/native-fs";
import { command_arguments, create_command_queue, run_command } from "../workspace/runtime/command";
import { DEFAULT_PYTHON_VERSION, uv_configuration } from "./runtime";
import type { UvApi } from "./types";

const enqueue = create_command_queue(); // 初始化与命令共用队列，避免并发创建共享工程。

/** 隔离宿主的 uv 与 Python 配置，工程、解释器、缓存和工具限定在应用数据根，保留应用代理。 */
function environment(pythonRoot: string, directory: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(?:UV_|PYTHON|PIP_|CONDA_|VIRTUAL_ENV$)/iu.test(key)) delete env[key];
  }
  return {
    ...env,
    UV_PROJECT: directory,
    UV_PYTHON_INSTALL_DIR: path.join(pythonRoot, "interpreters"),
    UV_CACHE_DIR: path.join(pythonRoot, "cache"),
    UV_TOOL_DIR: path.join(pythonRoot, "tools"),
    UV_TOOL_BIN_DIR: path.join(pythonRoot, "bin"),
    UV_PYTHON_BIN_DIR: path.join(pythonRoot, "bin"),
    UV_PYTHON_INSTALL_BIN: "0",
    UV_PYTHON_INSTALL_REGISTRY: "0", // 不写入 Windows 注册表
    UV_MANAGED_PYTHON: "1",
    UV_NO_PROGRESS: "1",
    PYTHONUTF8: "1",
    PYTHONUNBUFFERED: "1", // 输出写文件时不攒块，界面才能实时观察
    PYTHONNOUSERSITE: "1",
  };
}

/** uv 要求 `UV_PROJECT` 目录存在。种子只在目录缺失时写入，暂存后改名，中断不会留下无声明的工程。 */
async function initialize(directory: string): Promise<void> {
  if (fs.exists(directory)) return;
  const staging = `${directory}.prepare`;
  await fs.remove_async(staging, { recursive: true, force: true });
  await fs.write_file(
    path.join(staging, "pyproject.toml"),
    `[project]\nname = "lg-python"\nversion = "0.0.0"\nrequires-python = "==${DEFAULT_PYTHON_VERSION}.*"\ndependencies = []\n`,
  );
  fs.rename(staging, directory);
}

/** `@lg/uv` 的公开入口，只在完成绑定的根进程中可用。依赖声明、虚拟环境与恢复均由 uv 负责。 */
export const uv: UvApi = Object.freeze({
  /** 查询路径不创建工程，调用者可先检查或修复声明。 */
  get directory() {
    return path.join(uv_configuration().pythonRoot, "project");
  },
  /** 受理时固定参数与路径，初始化成功后再启动 uv。 */
  async run(args: readonly string[]): Promise<void> {
    const argv = command_arguments(args, "uv");
    const { pythonRoot, uvExecutable } = uv_configuration();
    const directory = uv.directory;
    await enqueue(async () => {
      await initialize(directory);
      // 程序以工作区为 cwd，相对路径与 Node 脚本一致。工程由 `UV_PROJECT` 定位。
      await run_command("uv", uvExecutable, ["--no-config", ...argv], {
        cwd: process.cwd(),
        env: environment(pythonRoot, directory),
      });
    });
  },
});
