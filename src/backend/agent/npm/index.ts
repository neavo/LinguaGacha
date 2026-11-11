import { createRequire } from "node:module";
import path from "node:path";
import { request_package_source } from "../package-source";
import { command_arguments, create_command_queue, run_command } from "../workspace/runtime/command";
import { NPM_REGISTRIES, npm_configuration } from "./runtime";
import type { NpmApi } from "./types";

const enqueue = create_command_queue();
// 可能解析或下载包的命令，别名由随附 npm 自身展开。
const PACKAGE_COMMANDS = new Set(["install", "ci", "update", "search", "view", "exec"]);

/** 随附 npm 的配置加载器，未提供类型声明，只描述这里读取的部分。 */
type NpmConfig = {
  load(): Promise<void>;
  get(key: string): unknown;
  find(key: string): string | null; // 值所在的配置层，内建默认值为 `default`
  parsedArgv: { remain: string[] };
};
type NpmConfigModule = new (options: Record<string, unknown>) => NpmConfig;

/**
 * 用随附 npm 自身的参数解析与配置加载判断：本次调用会取包，且 `registry` 仍是内建默认值。
 * CLI、环境、项目、用户和全局配置的优先级与 `exec --` 边界因此与实际执行一致。
 */
async function needs_default_registry(
  npm_path: string,
  argv: readonly string[],
  cwd: string,
): Promise<boolean> {
  const load = createRequire(path.join(npm_path, "package.json"));
  const Config = load("@npmcli/config") as NpmConfigModule;
  const { deref } = load("./lib/utils/cmd-list.js") as {
    deref(name: string | undefined): string | undefined;
  };
  const { definitions, flatten, nerfDarts, shorthands } = load(
    "@npmcli/config/lib/definitions",
  ) as Record<string, unknown>;
  const config = new Config({
    definitions,
    flatten,
    nerfDarts,
    shorthands,
    npmPath: npm_path,
    argv: [process.execPath, "npm", ...argv],
    env: { ...process.env }, // load 会写回 npm_config_*，副本保护根进程环境
    cwd,
    warn: false,
  });
  await config.load();
  if (config.get("usage") || config.get("version") || config.get("offline")) return false;
  return (
    PACKAGE_COMMANDS.has(deref(config.parsedArgv.remain[0]) ?? "") &&
    config.find("registry") === "default"
  );
}

/** `@lg/npm` 的公开入口，只在完成绑定的根进程中可用。 */
export const npm: NpmApi = Object.freeze({
  /** 返回宿主准备的共享工程，文件参数可据此定位。 */
  get directory() {
    return npm_configuration().nodeRoot;
  },
  /** 入队前固定参数，命令继承宿主准备的代理与 npm 配置，缺省 registry 由对话默认源补齐。 */
  async run(args: readonly string[]): Promise<void> {
    const argv = command_arguments(args, "npm");
    const { runtimeDirectory, nodeRoot } = npm_configuration();
    const npm_path = path.join(runtimeDirectory, "npm");
    await enqueue(async () => {
      // 只在没有任何配置层设置 registry 时注入，环境变量因此不会压过用户声明。
      const env = (await needs_default_registry(npm_path, argv, nodeRoot))
        ? { ...process.env, npm_config_registry: NPM_REGISTRIES[await request_package_source()] }
        : undefined;
      await run_command("npm", process.execPath, [path.join(npm_path, "bin/npm-cli.js"), ...argv], {
        cwd: nodeRoot,
        ...(env === undefined ? {} : { env }),
      });
    });
  },
});
