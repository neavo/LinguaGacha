import { execa } from "execa";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** npm 按打包目标准备纯二进制包，暂存安装与宿主依赖、用户工程相互独立。 */
export async function deploy_aria2({ root, workspaceDirectory, platform, arch }) {
  if (!["win32", "darwin", "linux"].includes(platform) || !["x64", "arm64"].includes(arch))
    throw new Error(`Unsupported aria2 target: ${platform}-${arch}`);
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const name = `@leisureyu/dsh-aria2-${platform}-${arch}`;
  const temporary = await mkdtemp(path.join(os.tmpdir(), "lg-aria2-"));
  try {
    await execa(
      process.execPath,
      [
        path.join(root, "node_modules/npm/bin/npm-cli.js"),
        "install",
        "--prefix",
        temporary,
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        `--os=${platform}`,
        `--cpu=${arch}`,
        `${name}@${manifest.workspaceRuntimeTools.aria2}`,
      ],
      { cwd: root, env: { ...process.env, NODE_OPTIONS: "" }, windowsHide: true, stdio: "inherit" },
    );
    const source = path.join(temporary, "node_modules", name);
    const directory = path.join(workspaceDirectory, "bin", `${platform}-${arch}`, "aria2");
    const executable = platform === "win32" ? "aria2c.exe" : "aria2c";
    await mkdir(directory, { recursive: true });
    await copyFile(path.join(source, "bin", executable), path.join(directory, executable));
    if (platform !== "win32") await chmod(path.join(directory, executable), 0o755);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
