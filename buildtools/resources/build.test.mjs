import path from "node:path";
import os from "node:os";
import { mkdtempDisposableSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import lockfile from "proper-lockfile";
import { expect, it } from "vitest";
import { build_resources } from "./build.mjs";

it("输出目录已被占用时拒绝构建并保留已有产物", async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), "lg-resource-lock-"));
  const file = path.join(output, "existing.txt");
  const release = await lockfile.lock(output, { realpath: false });
  try {
    await writeFile(file, "keep");
    await expect(build_resources({ output })).rejects.toMatchObject({ code: "ELOCKED" });
    expect(await readFile(file, "utf8")).toBe("keep");
  } finally {
    await release();
    await rm(output, { recursive: true, force: true });
  }
});

it("开发与发行默认输出各自持锁，拒绝写入对方的资源目录", async () => {
  using temporary = mkdtempDisposableSync(path.join(os.tmpdir(), "lg-resource-outputs-"));
  const root = temporary.path;
  await writeFile(path.join(root, "package.json"), "{}");
  await writeFile(path.join(root, "package-lock.json"), "{}");
  const development_output = path.join(root, "build/dev/resources");
  const release_output = path.join(root, "build/resources");
  await mkdir(development_output, { recursive: true });
  await mkdir(release_output, { recursive: true });
  const release_development = await lockfile.lock(development_output);
  const release_production = await lockfile.lock(release_output);
  try {
    for (const development of [false, true]) {
      await expect(build_resources({ root, development })).rejects.toMatchObject({
        code: "ELOCKED",
      });
      const output = development ? release_output : development_output;
      await expect(build_resources({ root, development, output })).rejects.toThrow(
        "overlaps its source",
      );
    }
  } finally {
    await release_production();
    await release_development();
  }
});

it("整体重建拒绝覆盖项目和依赖安装源", async () => {
  const root = path.resolve("fixture-source");
  for (const output of [
    root,
    path.dirname(root),
    path.join(root, "src"),
    path.join(root, "build"),
    path.join(root, "build/dev"),
    path.join(root, "node_modules/runtime"),
  ]) {
    await expect(build_resources({ root, output })).rejects.toThrow("overlaps its source");
  }
  if (process.platform === "win32") {
    await expect(
      build_resources({ root, output: path.join(root, "NODE_MODULES/runtime") }),
    ).rejects.toThrow("overlaps its source");
  }
});
