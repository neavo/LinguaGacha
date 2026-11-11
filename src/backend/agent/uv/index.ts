import path from "node:path";
import { default_native_fs as fs } from "../../../native/native-fs";
import { request_package_source } from "../package-source";
import { command_arguments, create_command_queue, run_command } from "../workspace/runtime/command";
import { DEFAULT_PYTHON_VERSION, UV_INDEXES, uv_configuration } from "./runtime";
import type { UvApi } from "./types";

const enqueue = create_command_queue(); // 初始化与命令共用队列，避免并发创建共享工程。
// 显式来源策略，出现后不再追加默认索引，避免混合两种来源。
const INDEX_OPTIONS = new Set([
  "--default-index",
  "--index",
  "--index-url",
  "-i",
  "--extra-index-url",
  "--no-index",
]);
const LOCAL_OPTIONS = new Set(["--offline", "--help", "-h", "--version", "-V"]); // 不访问包索引的调用
// 只记录取值选项以跳过其值，参数合法性仍由 uv 校验。随附 uv 升级时核对 run/tool run --help。
const VALUE_OPTIONS = new Set([
  "--extra",
  "--no-extra",
  "--group",
  "--no-group",
  "--only-group",
  "--no-editable-package",
  "--env-file",
  "--with",
  "-w",
  "--with-editable",
  "--with-requirements",
  "--package",
  "--python-platform",
  "--from",
  "--constraints",
  "-c",
  "--build-constraints",
  "-b",
  "--overrides",
  "--torch-backend",
  "--find-links",
  "-f",
  "--index-strategy",
  "--keyring-provider",
  "--upgrade-package",
  "-P",
  "--upgrade-group",
  "--resolution",
  "--prerelease",
  "--prerelease-package",
  "--fork-strategy",
  "--exclude-newer",
  "--exclude-newer-package",
  "--no-sources-package",
  "--reinstall-package",
  "--link-mode",
  "--config-setting",
  "-C",
  "--config-settings-package",
  "--no-build-isolation-package",
  "--no-build-package",
  "--no-binary-package",
  "--cache-dir",
  "--refresh-package",
  "--python",
  "-p",
  "--color",
  "--allow-insecure-host",
  "--directory",
  "--project",
  "--config-file",
]);
// 会解析、锁定或安装包的命令，`run` 另需同步环境。
const PACKAGE_COMMANDS = new Set([
  "add",
  "remove",
  "sync",
  "lock",
  "run",
  "pip install",
  "pip sync",
  "pip compile",
  "tool install",
  "tool upgrade",
  "tool run",
]);

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

/**
 * 只看 uv 自己的参数，`--` 与 `run`／`tool run` 的程序名之后属于被执行程序。
 */
function needs_default_index(argv: readonly string[]): boolean {
  const words: string[] = [];
  let sync = true;
  let skip_value = false; // 取值选项后的一个参数不参与命令和程序边界判断。
  for (const arg of argv) {
    if (skip_value) {
      skip_value = false;
      continue;
    }
    if (arg === "--") break;
    if (!arg.startsWith("-")) {
      words.push(arg);
      const [first, second] = words;
      if (
        first === "run"
          ? words.length === 2
          : first === "tool" && second === "run" && words.length === 3
      )
        break;
      continue;
    }
    const name = arg.split("=", 1)[0]!;
    if (
      INDEX_OPTIONS.has(name) ||
      LOCAL_OPTIONS.has(name) ||
      (arg.startsWith("-i") && !arg.startsWith("--"))
    )
      return false;
    if (name === "--no-sync") sync = false;
    skip_value = VALUE_OPTIONS.has(name) && !arg.includes("=");
  }
  const [command = "", subcommand = ""] = words;
  const name = command === "pip" || command === "tool" ? `${command} ${subcommand}` : command;
  return PACKAGE_COMMANDS.has(name) && (command !== "run" || sync);
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
      const env = environment(pythonRoot, directory);
      // 清理宿主配置之后注入，显式 CLI 索引参数仍优先于该环境变量。
      if (needs_default_index(argv))
        env["UV_DEFAULT_INDEX"] = UV_INDEXES[await request_package_source()];
      // 程序以工作区为 cwd，相对路径与 Node 脚本一致。工程由 `UV_PROJECT` 定位。
      await run_command("uv", uvExecutable, ["--no-config", ...argv], { cwd: process.cwd(), env });
    });
  },
});
