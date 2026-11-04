import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { prepare_development_resources, read_development_inputs } from "./development-cache.mjs";

const roots = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

/** 每个场景独占临时目录，失败后也由统一清理回收。 */
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "lg-development-cache-"));
  roots.push(root);
  return root;
}

it("未变化时复用静态资源，代码 chunk 变化不触发准备，缺失工具和输入变化触发重建", async () => {
  const output = path.join(await fixture(), "resources");
  const binary = path.join(output, "workspace/bin/supervisor.exe");
  let builds = 0;
  const prepare = async () => {
    builds += 1;
    await rm(output, { recursive: true, force: true });
    await mkdir(path.dirname(binary), { recursive: true });
    await writeFile(binary, `binary-${builds}`);
  };
  const build = (inputs = "initial") => prepare_development_resources({ output, inputs, prepare });
  await build();
  await build();
  expect(builds).toBe(1);
  const chunks = path.join(output, "workspace/chunks");
  await mkdir(chunks);
  await writeFile(path.join(chunks, "new.mjs"), "export default 1;");
  await build();
  expect(builds).toBe(1);
  await rm(binary);
  await build();
  expect(await readFile(binary, "utf8")).toBe("binary-2");
  await build("changed");
  expect(builds).toBe(3);
  await rm(output, { recursive: true });
  await build("changed");
  expect(builds).toBe(4);
});

it("准备失败后即使输入回退也重新构建，半成品不能命中旧缓存", async () => {
  const output = await fixture();
  const binary = path.join(output, "tool");
  const prepare = () => writeFile(binary, "complete");
  await prepare_development_resources({ output, inputs: "old", prepare });
  await expect(
    prepare_development_resources({
      output,
      inputs: "new",
      prepare: async () => {
        await writeFile(binary, "partial");
        throw new Error("build failed");
      },
    }),
  ).rejects.toThrow("build failed");
  await prepare_development_resources({ output, inputs: "old", prepare });
  expect(await readFile(binary, "utf8")).toBe("complete");
});

it("输入指纹覆盖依赖、构建规则、Go 文件增删和工具链，业务源码由独立构建处理", async () => {
  const root = await fixture();
  for (const directory of [
    "node_modules",
    "buildtools/resources",
    "buildtools/builder/supervisor",
    "src",
  ])
    await mkdir(path.join(root, directory), { recursive: true });
  for (const file of ["package.json", "package-lock.json", "node_modules/.package-lock.json"])
    await writeFile(path.join(root, file), "{}");
  let toolchain = "go-version-1";
  const inputs = () => read_development_inputs(root, () => ({ stdout: toolchain }));
  let previous = await inputs();
  await writeFile(path.join(root, "src/business.ts"), "export default 1;");
  expect(await inputs()).toBe(previous);
  for (const file of [
    "package-lock.json",
    "buildtools/resources/build.mjs",
    "buildtools/builder/supervisor/main.go",
  ]) {
    await writeFile(path.join(root, file), "changed");
    const current = await inputs();
    expect(current).not.toBe(previous);
    previous = current;
  }
  await rm(path.join(root, "buildtools/builder/supervisor/main.go"));
  expect(await inputs()).not.toBe(previous);
  previous = await inputs();
  toolchain = "go-version-2";
  expect(await inputs()).not.toBe(previous);
});
