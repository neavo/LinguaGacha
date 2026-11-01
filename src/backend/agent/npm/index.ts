import { spawn } from "node:child_process";
import path from "node:path";
import { npm_configuration, type NpmConfiguration } from "./runtime";
import type { NpmApi } from "./types";

let pending: Promise<unknown> = Promise.resolve(); // 同一根进程的调用共用队尾，避免并发写入共享工程。

/** 继承宿主准备的执行环境，应用代理、npm 配置与 Electron Node 设置随根进程传递。 */
function spawn_npm(
  { runtimeDirectory, nodeRoot }: NpmConfiguration,
  argv: readonly string[],
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(runtimeDirectory, "npm/bin/npm-cli.js"), ...argv],
      {
        cwd: nodeRoot,
        shell: false,
        windowsHide: true,
        detached: false,
        stdio: ["ignore", "inherit", "inherit"],
      },
    );
    let failure: unknown; // 启动失败之后仍会触发 close，统一在 close 中结算。
    child.once("error", (cause) => {
      failure = new Error("npm could not start.", { cause });
    });
    child.once("close", (exitCode, signal) => {
      if (failure) reject(failure);
      else if (exitCode !== 0)
        reject(new Error(`npm failed (exitCode=${exitCode}, signal=${signal}). See stderr log.`));
      else resolve();
    });
  });
}

/** `@lg/npm` 的公开入口，只在完成绑定的根进程中可用。 */
export const npm: NpmApi = Object.freeze({
  get directory() {
    return npm_configuration().nodeRoot;
  },
  /** 校验与执行共用参数副本，数组空位也参与校验，后续调用方修改不影响已受理的调用。 */
  async run(args: readonly string[]): Promise<void> {
    if (!Array.isArray(args)) throw new TypeError("npm arguments must be an array.");
    const argv = [...args];
    if (argv.some((value) => typeof value !== "string" || value.includes("\0")))
      throw new TypeError("npm arguments must be strings without NUL.");
    const configuration = npm_configuration();
    // 失败只恢复后续调度，原调用者仍收到原异常。
    const result = pending.then(() => spawn_npm(configuration, argv));
    pending = result.catch(() => undefined);
    await result;
  },
});
