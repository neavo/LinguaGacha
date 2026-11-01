import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { deploy_uv } from "./uv.mjs";

const roots = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it.each([
  ["darwin-arm64", "uv-aarch64-apple-darwin.tar.gz"],
  ["darwin-x64", "uv-x86_64-apple-darwin.tar.gz"],
  ["win32-arm64", "uv-aarch64-pc-windows-msvc.zip"],
  ["win32-x64", "uv-x86_64-pc-windows-msvc.zip"],
  ["linux-arm64", "uv-aarch64-unknown-linux-gnu.tar.gz"],
  ["linux-x64", "uv-x86_64-unknown-linux-gnu.tar.gz"],
])("%s 使用项目配置版本下载归档并只部署 uv", async (target, filename) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lg-uv-"));
  roots.push(root);
  const [platform, arch] = target.split("-");
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ workspaceRuntimeTools: { uv: "1.2.3" } }),
  );
  const name = platform === "win32" ? "uv.exe" : "uv";
  await writeFile(path.join(root, name), target);
  const download = vi.fn(async () => root);
  const workspaceDirectory = path.join(root, "workspace");
  await deploy_uv({ root, workspaceDirectory, platform, arch, download });
  expect(download.mock.calls[0]?.slice(0, 2)).toEqual(["1.2.3", filename]);
  expect(download.mock.calls[0]?.[3]).toBe("astral-sh/uv");
  const directory = path.join(workspaceDirectory, "bin", target);
  expect(await readFile(path.join(directory, name), "utf8")).toBe(target);
  expect(await readdir(directory)).toEqual([name]);
  if (platform !== "win32" && process.platform !== "win32")
    expect((await stat(path.join(directory, name))).mode & 0o111).toBe(0o111);
});

it("不支持的目标与缺失产物都阻止部署", async () => {
  const download = vi.fn();
  await expect(
    deploy_uv({ workspaceDirectory: "unused", platform: "win32", arch: "ia32", download }),
  ).rejects.toThrow("Unsupported uv target");
  expect(download).not.toHaveBeenCalled();
  const root = await mkdtemp(path.join(os.tmpdir(), "lg-uv-missing-"));
  roots.push(root);
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ workspaceRuntimeTools: { uv: "1.2.3" } }),
  );
  await expect(
    deploy_uv({
      root,
      workspaceDirectory: root,
      platform: "win32",
      arch: "x64",
      download: async () => root,
    }),
  ).rejects.toMatchObject({ code: "ENOENT" });
});
