import path from "node:path";
import { command_arguments, create_command_queue, run_command } from "../workspace/runtime/command";
import { npm_configuration } from "./runtime";
import type { NpmApi } from "./types";

const enqueue = create_command_queue();

/** `@lg/npm` 的公开入口，只在完成绑定的根进程中可用。 */
export const npm: NpmApi = Object.freeze({
  /** 返回宿主准备的共享工程，文件参数可据此定位。 */
  get directory() {
    return npm_configuration().nodeRoot;
  },
  /** 入队前固定参数，命令继承宿主准备的代理与 npm 配置。 */
  async run(args: readonly string[]): Promise<void> {
    const argv = command_arguments(args, "npm");
    const { runtimeDirectory, nodeRoot } = npm_configuration();
    await enqueue(() =>
      run_command(
        "npm",
        process.execPath,
        [path.join(runtimeDirectory, "npm/bin/npm-cli.js"), ...argv],
        { cwd: nodeRoot },
      ),
    );
  },
});
