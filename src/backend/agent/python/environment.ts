import path from "node:path";
import { default_native_fs as fs } from "../../../native/native-fs";
import { enqueue_python, python_configuration, python_json, python_process, uv } from "./runtime";
import type { PythonApi, PythonEnvironment, PythonInfo, PythonInstallation } from "./types";

const DEFAULT_PYTHON_VERSION = "3.13"; // 默认次版本保持稳定，避免应用升级隐式新建依赖环境。

/** 版本只能选择次版本，不能被 uv 解释为路径或命令选项。 */
function version_input(value: string): string {
  if (typeof value !== "string" || !/^3\.(?:0|[1-9]\d*)$/u.test(value))
    throw new TypeError("Python version must be an explicit CPython minor version, e.g. 3.13.");
  return value;
}

/** 入队前复制参数，后续调用方修改不影响已受理的操作。 */
function arguments_input(values: readonly string[], nonempty: boolean): string[] {
  if (!Array.isArray(values)) throw new TypeError("Python arguments must be an array.");
  const args = [...values]; // 展开空位后再校验，避免 uv 把空位当成包名或脚本参数。
  if (
    (nonempty && args.length === 0) ||
    args.some(
      (value) => typeof value !== "string" || value.includes("\0") || (nonempty && !value.trim()),
    )
  )
    throw new TypeError(
      "Python arguments must be strings without NUL; package lists must be nonempty.",
    );
  return args;
}

/** 只有缺失允许初始化或重建，权限和 IO 错误继续向外传播。 */
function exists(target: string): boolean {
  try {
    fs.lstat(target);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

/** 补丁升级链接与实际安装路径必须指向同一解释器身份。 */
function identity(target: string): string {
  return fs.to_identity_path(fs.real_path(target));
}

/** 按真实路径段核对归属，避免目录链接越过应用管理范围。 */
function inside(root: string, target: string): boolean {
  const relative = path.relative(identity(root), identity(target));
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

type Project = Readonly<{ version: string; directory: string; venv: string; marker: string }>;
/** 只选择位置，使损坏环境也能先取得修改依赖的句柄。 */
function project(version: string): Project {
  const directory = path.join(python_configuration().pythonRoot, "environments", version);
  return {
    version,
    directory,
    venv: path.join(directory, ".venv"),
    marker: path.join(directory, ".incomplete"),
  };
}

/** 固定目录拒绝链接，防止恢复时清理应用环境以外的安装树。 */
function owned_directory(target: string): void {
  if (exists(target) && !fs.lstat(target).isDirectory())
    throw new Error(`Python managed directory must not be a link or file: ${target}`);
}

/** 只暂存初始声明，venv 在最终路径创建以保持解释器引用有效。 */
async function initialize(value: Project): Promise<void> {
  const parent = path.dirname(value.directory);
  owned_directory(python_configuration().pythonRoot);
  owned_directory(parent);
  fs.make_dir(parent);
  owned_directory(value.directory);
  const staging = `${value.directory}.prepare`;
  owned_directory(staging);
  await fs.remove_async(staging, { recursive: true, force: true });
  if (!exists(value.directory)) {
    fs.make_dir(staging);
    fs.write_file_atomic(
      path.join(staging, "pyproject.toml"),
      `[project]\nname = "lg-python-${value.version.replace(".", "-")}"\nversion = "0.0.0"\nrequires-python = "==${value.version}.*"\ndependencies = []\n`,
    );
    fs.rename(staging, value.directory);
  }
  // 已有声明交 uv 解析，缺失时保留现场，不能恢复为空依赖工程。
  if (!exists(path.join(value.directory, "pyproject.toml")))
    throw new Error(`Python dependency declaration is missing: ${value.directory}`);
}

// 同时核对环境与基础解释器，排除半成品 venv 回落到基础安装的情况。
const QUERY =
  "import json,sys; print(json.dumps(dict(version='.'.join(map(str,sys.version_info[:3])),prefix=sys.prefix,basePrefix=sys.base_prefix,baseExecutable=sys._base_executable)))";
type Interpreter = Readonly<{
  version: string;
  prefix: string;
  basePrefix: string;
  baseExecutable: string;
}>;
/** 解释器输出跨越进程边界，先收窄字段再参与目录归属判断。 */
async function query(executable: string): Promise<Interpreter> {
  const value = python_json(
    await python_process(executable, ["-I", "-c", QUERY], "inspect environment", true),
  );
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value && typeof value.version === "string") ||
    !("prefix" in value && typeof value.prefix === "string") ||
    !("basePrefix" in value && typeof value.basePrefix === "string") ||
    !("baseExecutable" in value && typeof value.baseExecutable === "string")
  )
    throw new Error("Invalid Python interpreter information.");
  return {
    version: value.version,
    prefix: value.prefix,
    basePrefix: value.basePrefix,
    baseExecutable: value.baseExecutable,
  };
}

/** 直接定位所选环境，避免 PATH 或活动 venv 改变查询对象。 */
function executable(value: Project): string {
  return path.join(value.venv, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
}

/** 可执行文件存在并不代表 venv 完整，写包前必须核对实际 prefix。 */
async function information(value: Project, selected?: string): Promise<PythonInfo> {
  owned_directory(value.venv);
  if (!exists(path.join(value.venv, "pyvenv.cfg")))
    throw new Error("Python environment has no pyvenv.cfg.");
  const result = await query(executable(value));
  const managed = path.join(python_configuration().pythonRoot, "interpreters");
  if (
    identity(result.prefix) !== identity(value.venv) ||
    identity(result.prefix) === identity(result.basePrefix) ||
    !inside(managed, result.baseExecutable) ||
    !inside(managed, result.basePrefix) ||
    !result.version.startsWith(`${value.version}.`) ||
    (selected !== undefined && identity(result.baseExecutable) !== identity(selected))
  )
    throw new Error("Python environment does not belong to the selected managed interpreter.");
  return Object.freeze({
    version: result.version,
    executable: executable(value),
    directory: value.directory,
  });
}

/** 标记覆盖整个修改操作，任何失败均留给下一次重建安装结果。 */
async function modify(
  value: Project,
  action: (value: Project) => Promise<void>,
  upgrade = false,
): Promise<void> {
  await initialize(value);
  const recover = exists(value.marker);
  fs.write_file_atomic(value.marker, "");
  const selected = await prepare_interpreter(value, upgrade);
  await prepare_environment(value, selected, recover);
  // 显式依赖修改先应用新意图，不能要求待修复的旧声明先解析成功。
  await action(value);
  await information(value, selected);
  await fs.remove_async(value.marker);
}

/** 重复安装会修复搬移后的链接，只有显式升级才请求新补丁。 */
async function prepare_interpreter(value: Project, upgrade: boolean): Promise<string> {
  await uv(
    [
      "python",
      "install",
      value.version,
      ...(upgrade ? ["--upgrade"] : []),
      "--no-bin",
      "--no-registry",
    ],
    "prepare interpreter",
    false,
    true,
  );
  const selected = (
    await uv(
      [
        "python",
        "find",
        "--no-project",
        "--system",
        "--managed-python",
        "--no-python-downloads",
        value.version,
      ],
      "find interpreter",
      true,
    )
  ).trim();
  if (
    !path.isAbsolute(selected) ||
    !inside(path.join(python_configuration().pythonRoot, "interpreters"), selected)
  )
    throw new Error("uv selected an interpreter outside the application directory.");
  return selected;
}

/** 这里只确认可安全写包的环境，依赖声明的修改和解析由后续操作负责。 */
async function prepare_environment(
  value: Project,
  selected: string,
  recover: boolean,
): Promise<void> {
  owned_directory(value.venv);
  // 未完成标记已要求重建，省去启动不可信的旧解释器。其余环境通过查询决定是否复用。
  let healthy = false;
  if (!recover) {
    try {
      await information(value, selected);
      healthy = true;
    } catch {
      /* 安装树可重建。 */
    }
  }
  if (!healthy) {
    await uv(
      [
        "venv",
        "--python",
        value.version, // 次版本请求保留 uv 的补丁升级链接，绝对路径仅用于归属核对。
        ...(exists(value.venv) ? ["--clear", "--force"] : []),
        value.venv,
      ],
      "rebuild environment",
    );
    await information(value, selected); // 写包前确认 prefix，不能只相信 uv 的成功退出。
  }
}

/** uv sync 自行更新锁文件，串行操作中无需再单独解析一次依赖。 */
async function sync_dependencies(value: Project): Promise<void> {
  await uv(
    ["sync", "--project", value.directory, "--python", value.version, "--no-python-downloads"],
    "sync dependencies",
  );
}

/** 句柄只绑定次版本，每次异步操作仍经过同一队列和环境归属检查。 */
function handle(value: Project): PythonEnvironment {
  // add/remove 自行解析新声明，使坏依赖也能通过显式修改恢复。
  const packages = (command: "add" | "remove", values: readonly string[]): Promise<void> => {
    const args = arguments_input(values, true);
    return enqueue_python(() =>
      modify(value, async () => {
        await uv(
          [
            command,
            "--project",
            value.directory,
            "--python",
            value.version,
            "--no-python-downloads",
            "--",
            ...args,
          ],
          command === "add" ? "install packages" : "remove packages",
        );
      }),
    );
  };
  return Object.freeze({
    ensure: () => enqueue_python(() => modify(value, sync_dependencies)),
    upgrade: () => enqueue_python(() => modify(value, sync_dependencies, true)),
    info: () =>
      enqueue_python(() => {
        if (exists(value.marker))
          throw new Error("Python environment is incomplete; call ensure to recover.");
        return information(value);
      }),
    install: (values: readonly string[]) => packages("add", values),
    remove: (values: readonly string[]) => packages("remove", values),
    run: (values: readonly string[]) => {
      const args = arguments_input(values, false);
      return enqueue_python(async () => {
        await modify(value, sync_dependencies);
        // 用户脚本失败不代表包环境损坏，准备成功后已清除标记。
        await uv(
          [
            "run",
            "--project",
            value.directory,
            "--python",
            value.version,
            "--no-sync",
            "--no-python-downloads",
            "--",
            "python",
            ...args,
          ],
          "run program",
        );
      });
    },
  });
}

/** 公开入口与 bootstrap 的私有绑定共享运行实例，查询也遵循操作顺序。 */
export const python: PythonApi = Object.freeze({
  environment: (options?: Readonly<{ version?: string }>) => {
    const version = version_input(options?.version ?? DEFAULT_PYTHON_VERSION);
    return handle(project(version));
  },
  list: () =>
    enqueue_python(async () => {
      const root = path.join(python_configuration().pythonRoot, "interpreters");
      const result = python_json(
        await uv(
          ["python", "list", "--only-installed", "--managed-python", "--output-format", "json"],
          "list interpreters",
          true,
        ),
      );
      if (!Array.isArray(result)) throw new Error("Invalid uv interpreter list.");
      const installations: PythonInstallation[] = [];
      for (const entry of result as unknown[]) {
        if (typeof entry !== "object" || entry === null || !("path" in entry) || !entry.path)
          continue;
        if (
          typeof entry.path !== "string" ||
          !("version" in entry) ||
          typeof entry.version !== "string"
        )
          throw new Error("Invalid uv interpreter entry.");
        if (inside(root, entry.path))
          installations.push(Object.freeze({ version: entry.version, executable: entry.path }));
      }
      return Object.freeze(installations);
    }),
});
