import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Arch } from "builder-util";
import { afterEach, expect, it } from "vitest";
import {
  deploy_packaged_tools,
  deploy_workspace_tools,
  resolve_builder_arch,
} from "./native-tools.mjs";

const roots = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
/** 用真实输出文件验证部署，只替换外部 Go 命令。 */
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "lg-native-tools-"));
  roots.push(root);
  const appDirectory = path.join(root, "release");
  const workspaceDirectory = path.join(appDirectory, "resources/workspace");
  await mkdir(appDirectory);
  const calls = [];
  const run = async (_command, args, options) => {
    calls.push({ args, options });
    if (args[0] === "build") {
      const output = args[args.indexOf("-o") + 1];
      await mkdir(path.dirname(output), { recursive: true });
      await writeFile(output, options.env.GOARCH);
    }
  };
  // 替身在返回前写出产物，部署仍通过真实文件系统验证。
  return { root, appDirectory, workspaceDirectory, calls, run };
}

it.each([
  ["x64", "amd64"],
  ["arm64", "arm64"],
])("Windows %s 从同一入口构建四个工具并按消费方安装", async (arch, expected) => {
  const test = await fixture();
  await deploy_packaged_tools({ ...test, platform: "win32", arch });
  for (const name of ["cli", "berserker"])
    expect(await readFile(path.join(test.appDirectory, `${name}.exe`), "utf8")).toBe(expected);
  const bin = path.join(test.workspaceDirectory, `bin/win32-${arch}`);
  for (const name of ["supervisor", "node"])
    expect(await readFile(path.join(bin, `${name}.exe`), "utf8")).toBe(expected);
  expect(
    test.calls.find(
      ({ args, options }) => args[0] === "build" && path.basename(options.cwd) === "berserker",
    ).args,
  ).toContain("-s -w -H windowsgui");
  const hostArch = process.arch === "x64" ? "amd64" : "arm64";
  expect(
    test.calls
      .filter(({ args }) => args[0] === "test")
      .every(({ options }) => options.env.GOARCH === hostArch),
  ).toBe(true);
});

it.each(["linux", "darwin"])("%s 发行只安装监管器和 exec 启动脚本", async (platform) => {
  const test = await fixture();
  await deploy_packaged_tools({ ...test, platform, arch: "arm64" });
  expect(test.calls.find(({ args }) => args[0] === "build").options.env).toMatchObject({
    GOOS: platform,
    GOARCH: "arm64",
    CGO_ENABLED: "0",
  });
  const bin = path.join(test.workspaceDirectory, `bin/${platform}-arm64`);
  expect((await readdir(bin)).sort()).toEqual(["node", "npm", "npx", "supervisor"]);
});

it.each([
  [Arch.x64, "x64"],
  [Arch.arm64, "arm64"],
])("转换 builder 架构 %s", (input, expected) => {
  expect(resolve_builder_arch(input)).toBe(expected);
});
it("拒绝不支持的目标架构", () => {
  expect(() => resolve_builder_arch(Arch.ia32)).toThrow("Unsupported release architecture");
});
it("缺少 Go 时保留原始原因，构建缺失产物时失败", async () => {
  const test = await fixture();
  const cause = Object.assign(new Error("missing go"), { code: "ENOENT" });
  await expect(
    deploy_workspace_tools({
      ...test,
      platform: "win32",
      arch: "x64",
      run: () => {
        throw cause;
      },
    }),
  ).rejects.toMatchObject({ cause });
  await expect(
    deploy_workspace_tools({ ...test, platform: "win32", arch: "x64", run: () => {} }),
  ).rejects.toThrow("Cannot read native tool");
});
