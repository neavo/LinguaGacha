import { chmod, copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { getBinFromUrl } from "app-builder-lib/out/binDownload.js";

// 发行名使用 LLVM 目标名称，不能直接拼接 Node 的平台和架构。
const UV_TARGETS = Object.freeze({
  "darwin-arm64": "uv-aarch64-apple-darwin.tar.gz",
  "darwin-x64": "uv-x86_64-apple-darwin.tar.gz",
  "win32-arm64": "uv-aarch64-pc-windows-msvc.zip",
  "win32-x64": "uv-x86_64-pc-windows-msvc.zip",
  "linux-arm64": "uv-aarch64-unknown-linux-gnu.tar.gz",
  "linux-x64": "uv-x86_64-unknown-linux-gnu.tar.gz",
});

/** 开发与发行共用固定版本，禁止回退到宿主 PATH。 */
export async function deploy_uv({
  root,
  workspaceDirectory,
  platform,
  arch,
  download = getBinFromUrl,
}) {
  const target = `${platform}-${arch}`;
  const filename = UV_TARGETS[target];
  if (!filename) throw new Error(`Unsupported uv target: ${target}`);
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  // 当前下载器以 strip: 1 解压 tar.gz，六个目标均返回可执行文件所在目录。
  const source = await download(
    manifest.workspaceRuntimeTools.uv,
    filename,
    undefined,
    "astral-sh/uv",
  );
  const executable = platform === "win32" ? "uv.exe" : "uv";
  const directory = path.join(workspaceDirectory, "bin", target);
  await mkdir(directory, { recursive: true });
  await copyFile(path.join(source, executable), path.join(directory, executable));
  if (platform !== "win32") await chmod(path.join(directory, executable), 0o755);
}
