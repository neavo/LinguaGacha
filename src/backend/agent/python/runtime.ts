import { spawn } from "node:child_process";
import path from "node:path";

export type PythonConfiguration = Readonly<{ pythonRoot: string; uvExecutable: string }>;

let configuration: PythonConfiguration | undefined; // 每次根脚本启动时绑定，后代进程没有该绑定。
let pending: Promise<unknown> = Promise.resolve(); // 所有句柄共用队尾，覆盖跨次版本操作。

/** 只由根进程 bootstrap 绑定，共享 chunk 保证公共入口消费同一实例。 */
export function bind_python(value: PythonConfiguration): void {
  if (configuration) throw new Error("Python workspace runtime is already bound.");
  configuration = Object.freeze({ ...value });
}

/** 拒绝未绑定的后代，避免它们另建队列并发修改共享环境。 */
export function python_configuration(): PythonConfiguration {
  if (!configuration) throw new Error("Current process is not bound to a workspace runtime.");
  return configuration;
}

/** 队列覆盖完整操作，失败只恢复后续调度，原调用者仍收到原异常。 */
export function enqueue_python<T>(action: () => Promise<T>): Promise<T> {
  const result = pending.then(action);
  pending = result.catch(() => undefined);
  return result;
}

/** 每次构造局部环境，保留本次执行的应用代理。 */
function environment(install: boolean): NodeJS.ProcessEnv {
  const { pythonRoot } = python_configuration();
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(?:UV_|PYTHON|PIP_|CONDA_|VIRTUAL_ENV$)/iu.test(key)) delete env[key];
  }
  return {
    ...env,
    UV_PYTHON_INSTALL_DIR: path.join(pythonRoot, "interpreters"),
    UV_CACHE_DIR: path.join(pythonRoot, "cache"),
    UV_PYTHON_BIN_DIR: path.join(pythonRoot, "bin"),
    UV_PYTHON_INSTALL_BIN: "0",
    UV_PYTHON_INSTALL_REGISTRY: "0",
    UV_MANAGED_PYTHON: "1",
    UV_PYTHON_DOWNLOADS: install ? "automatic" : "never",
    UV_NO_PROGRESS: "1",
    PYTHONUTF8: "1",
    PYTHONNOUSERSITE: "1",
  };
}

/** 机器查询才捕获小型输出，用户输出直接写入已有日志句柄。 */
export async function python_process(
  executable: string,
  args: readonly string[],
  stage: string,
  capture = false,
  install = false,
): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(executable, [...args], {
      cwd: process.cwd(),
      env: environment(install),
      shell: false,
      windowsHide: true,
      detached: false,
      stdio: ["ignore", capture ? "pipe" : "inherit", "inherit"],
    });
    let output = "";
    let failure: unknown;
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk;
    });
    child.once("error", (cause) => {
      failure = new Error(`Python ${stage} could not start.`, { cause });
    });
    child.once("close", (exitCode, signal) => {
      if (failure) reject(failure);
      else if (exitCode !== 0)
        reject(
          new Error(
            `Python ${stage} failed (exitCode=${exitCode}, signal=${signal}). See stderr log.`,
          ),
        );
      else resolve(output);
    });
  });
}

/** 配置发现统一关闭，调用点只表达命令自身的参数。 */
export async function uv(
  args: readonly string[],
  stage: string,
  capture = false,
  install = false,
): Promise<string> {
  return await python_process(
    python_configuration().uvExecutable,
    ["--no-config", ...args],
    stage,
    capture,
    install,
  );
}

/** 保留解析失败的原始上下文，便于从执行日志定位异常输出。 */
export function python_json(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new Error("Invalid Python query JSON.", { cause });
  }
}
