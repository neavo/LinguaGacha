import { cp, lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/** 在系统租约内初始化用户工程。种子只复制一次，后续准备保留用户事实。 */
async function prepare(): Promise<void> {
  const [runtime, root] = process.argv.slice(2);
  if (!runtime || !root) throw new Error("Invalid Node preparation arguments.");
  await mkdir(path.dirname(root), { recursive: true });
  // 系统租约保证只有一个准备程序。固定暂存位置用于回收上次中断的复制。
  const staging = `${path.resolve(root)}.prepare`;
  await rm(staging, { recursive: true, force: true });
  try {
    if (!(await exists(root))) {
      await cp(path.join(runtime, "seed"), staging, { recursive: true, verbatimSymlinks: true });
      await rename(staging, root);
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
  } finally {
    await rm(staging, { recursive: true, force: true });
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

await prepare();
