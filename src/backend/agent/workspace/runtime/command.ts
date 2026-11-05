import { spawn } from "node:child_process";

/** 入队前复制并校验参数，数组空位也参与校验，后续调用方修改不影响已受理的调用。 */
export function command_arguments(args: readonly string[], name: string): string[] {
  if (!Array.isArray(args)) throw new TypeError(`${name} arguments must be an array.`);
  const argv = [...args];
  if (argv.some((value) => typeof value !== "string" || value.includes("\0")))
    throw new TypeError(`${name} arguments must be strings without NUL.`);
  return argv;
}

/** 同一根进程内的调用共用队尾，避免并发写入共享工程。失败只恢复后续调度，原调用者仍收到原异常。 */
export function create_command_queue(): (action: () => Promise<void>) => Promise<void> {
  let pending: Promise<unknown> = Promise.resolve();
  return (action) => {
    const result = pending.then(action);
    pending = result.catch(() => undefined);
    return result;
  };
}

/** 不经 shell 启动包管理器，输出直接写入当前工具日志，非零退出抛错。 */
export function run_command(
  name: string,
  executable: string,
  args: readonly string[],
  options: Readonly<{ cwd: string; env?: NodeJS.ProcessEnv }>,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
      detached: false,
      stdio: ["ignore", "inherit", "inherit"],
    });
    let failure: unknown; // 启动失败之后仍会触发 close，统一在 close 中结算。
    child.once("error", (cause) => {
      failure = new Error(`${name} could not start.`, { cause });
    });
    child.once("close", (exitCode, signal) => {
      if (failure) reject(failure);
      else if (exitCode !== 0)
        reject(
          new Error(`${name} failed (exitCode=${exitCode}, signal=${signal}). See stderr log.`),
        );
      else resolve();
    });
  });
}
