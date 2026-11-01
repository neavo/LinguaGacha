import { cp, lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout } from "node:timers/promises";

const FILE_RETRY = Object.freeze({ maxRetries: 5, retryDelay: 200 });

/** 在系统租约内初始化用户工程。种子只复制一次，后续准备保留用户事实。 */
export async function prepare_node_environment(runtime: string, root: string): Promise<void> {
  await mkdir(path.dirname(root), { recursive: true });
  // 租约内只在准备开始时回收残留，失败保留暂存材料及原始错误。
  const staging = `${path.resolve(root)}.prepare`;
  await rm(staging, { recursive: true, force: true, ...FILE_RETRY });
  if (!(await exists(root))) {
    await cp(path.join(runtime, "seed"), staging, { recursive: true, verbatimSymlinks: true });
    await rename_prepared_directory(staging, root);
  }
  // 当前目录缺清单时仍锚定 npm 本地工程，保留 npm init 等恢复入口。
  await mkdir(path.join(root, "node_modules"), { recursive: true });
  for (const [name, content] of [
    ["npmrc", "cache=${LG_NODE_ROOT}/cache\nprefix=${LG_NODE_ROOT}/global\n"],
    ["global.npmrc", ""],
  ] as const) {
    try {
      await writeFile(path.join(root, name), content, { flag: "wx" });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    }
  }
}

/** Windows 扫描程序可能短暂占用刚复制的目录，仅重试提交，避免重复复制种子。 */
async function rename_prepared_directory(staging: string, root: string): Promise<void> {
  for (let retry = 0; ; retry++) {
    try {
      await rename(staging, root);
      return;
    } catch (error) {
      if (
        process.platform !== "win32" ||
        retry >= FILE_RETRY.maxRetries ||
        !(error instanceof Error) ||
        !("code" in error) ||
        (error.code !== "EPERM" && error.code !== "EBUSY")
      )
        throw error;
    }
    await setTimeout(FILE_RETRY.retryDelay * (retry + 1));
  }
}

/** 仅把缺失视为首次初始化，权限和 IO 故障继续交给调用方。 */
async function exists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

if (import.meta.main) {
  const [runtime, root] = process.argv.slice(2);
  if (!runtime || !root) throw new Error("Invalid Node preparation arguments.");
  await prepare_node_environment(runtime, root);
}
