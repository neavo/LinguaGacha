import { execa } from "execa";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** 获取目标二进制归档，避开 `npm install` 的宿主架构检查。 */
export async function deploy_aria2({ root, workspaceDirectory, platform, arch }) {
  if (!["win32", "darwin", "linux"].includes(platform) || !["x64", "arm64"].includes(arch))
    throw new Error(`Unsupported aria2 target: ${platform}-${arch}`);
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const name = `@leisureyu/dsh-aria2-${platform}-${arch}`;
  const temporary = await mkdtemp(path.join(os.tmpdir(), "lg-aria2-"));
  try {
    const { stdout: filename } = await execa(
      process.execPath,
      [
        path.join(root, "node_modules/npm/bin/npm-cli.js"),
        "pack",
        "--pack-destination",
        temporary,
        "--ignore-scripts",
        `${name}@${manifest.workspaceRuntimeTools.aria2}`,
      ],
      {
        cwd: root,
        env: { ...process.env, NODE_OPTIONS: "" },
        windowsHide: true,
        stderr: "inherit",
      },
    );
    const directory = path.join(workspaceDirectory, "bin", `${platform}-${arch}`, "aria2");
    const executable = platform === "win32" ? "aria2c.exe" : "aria2c";
    await execa(
      "tar",
      ["-xzf", path.join(temporary, filename), "-C", temporary, `package/bin/${executable}`],
      { windowsHide: true, stdio: "inherit" },
    );
    await mkdir(directory, { recursive: true });
    await copyFile(
      path.join(temporary, "package", "bin", executable),
      path.join(directory, executable),
    );
    if (platform !== "win32") await chmod(path.join(directory, executable), 0o755);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
