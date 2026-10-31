import { cp, copyFile, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

type ApplicationPackage = Readonly<{ name: string; version: string; path: string }>;

/** 只在系统租约内启动本程序，目录复制和 npm 都归监管程序回收。 */
async function prepare(): Promise<void> {
  const [runtime, root, mode] = process.argv.slice(2);
  if (!runtime || !root || (mode !== "exec" && mode !== "run"))
    throw new Error("Invalid Node preparation arguments.");
  await mkdir(path.dirname(root), { recursive: true });
  // 系统租约保证只有一个准备程序；固定暂存位置在下次进入时回收强制终止的残留。
  const staging = `${path.resolve(root)}.prepare`;
  await rm(staging, { recursive: true, force: true });
  try {
    await prepare_environment(runtime, root, mode, staging);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/** 现有工程保留用户事实，应用包只通过 npm 更新。 */
async function prepare_environment(
  runtime: string,
  root: string,
  mode: "exec" | "run",
  staging: string,
): Promise<void> {
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
  if (mode !== "run") return;
  const packages: ApplicationPackage[] = JSON.parse(
    await readFile(path.join(runtime, "app-packages.json"), "utf8"),
  );
  const updates: string[] = [];
  for (const pkg of packages) {
    const installed = path.join(root, "node_modules", pkg.name, "package.json");
    let version: unknown;
    try {
      version = JSON.parse(await readFile(installed, "utf8")).version;
    } catch (error) {
      if (
        !(
          error instanceof SyntaxError ||
          (error instanceof Error && "code" in error && error.code === "ENOENT")
        )
      )
        throw error;
    }
    if (version === pkg.version) continue;
    await mkdir(path.dirname(path.join(root, pkg.path)), { recursive: true });
    const target = path.join(root, pkg.path);
    const temporary = path.join(staging, pkg.path);
    await mkdir(path.dirname(temporary), { recursive: true });
    // 完整复制后再替换；初始化和包更新的中断材料由同一暂存目录收尾。
    await copyFile(path.join(runtime, "seed", pkg.path), temporary);
    await rename(temporary, target);
    updates.push(`./${pkg.path}`);
  }
  if (updates.length === 0) return;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        path.join(runtime, "npm/bin/npm-cli.js"),
        "install",
        "--offline",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        ...updates,
      ],
      { cwd: root, stdio: ["ignore", "inherit", "inherit"], windowsHide: true },
    );
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      code === 0
        ? resolve()
        : reject(new Error(`Application package update failed (${code}, ${signal}).`)),
    );
  });
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
