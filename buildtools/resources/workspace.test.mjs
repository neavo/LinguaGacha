import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { deploy_workspace_dependencies } from "./workspace.mjs";
const npm = path.resolve("node_modules/npm/bin/npm-cli.js");
const runNpm = (cwd, args) =>
  execFileSync(process.execPath, [npm, ...args], { cwd, windowsHide: true });

// 两次 npm 查询及独立 Node 导入共享全量测试的进程启动预算。
it("独立部署后端依赖并保留嵌套版本、运行资源和其它生成步骤的产物", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lg-workspace-dependencies-"));
  const root = path.join(directory, "source");
  const output = path.join(directory, "runtime");
  try {
    await mkdir(root);
    const manifest = {
      name: "fixture",
      private: true,
      workspaceRuntimePackages: { agent: ["unused"], backend: ["alpha", "beta"] },
      dependencies: { alpha: "1.0.0", beta: "1.0.0", unused: "1.0.0" },
    };
    await writeFile(path.join(root, "package.json"), JSON.stringify(manifest));
    await create_package(
      root,
      "alpha",
      "1.0.0",
      { shared: "1.0.0" },
      "export { default } from 'shared';",
    );
    await create_package(
      root,
      "beta",
      "1.0.0",
      { shared: "2.0.0" },
      "export { default } from 'shared';",
    );
    await create_package(root, "shared", "1.0.0", {}, "export default 1;");
    await create_package(
      path.join(root, "node_modules/beta"),
      "shared",
      "2.0.0",
      {},
      "export default 2;",
    );
    await create_package(root, "unused", "1.0.0", {}, "export default 3;");
    await writeFile(path.join(root, "node_modules/alpha/README.md"), "包的使用说明");
    await writeFile(
      path.join(root, "node_modules/alpha/engine.wasm"),
      new Uint8Array([0, 97, 115, 109]),
    );

    await writeFile(path.join(root, "node_modules/alpha/index.js.map"), "{}");
    await writeFile(path.join(root, "node_modules/alpha/index.d.ts"), "export default 1;");

    await deploy_workspace_dependencies({
      root,
      output,
      names: manifest.workspaceRuntimePackages.backend,
      runNpm,
    });
    expect(
      execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          "import a from 'alpha'; import b from 'beta'; console.log(JSON.stringify([a, b]));",
        ],
        { cwd: output, encoding: "utf8", windowsHide: true },
      ).trim(),
    ).toBe("[1,2]");
    expect(await readFile(path.join(output, "node_modules/alpha/README.md"), "utf8")).toBe(
      "包的使用说明",
    );
    await expect(
      readFile(path.join(output, "node_modules/alpha/index.js.map")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(path.join(output, "node_modules/alpha/index.d.ts"), "utf8")).toBe(
      "export default 1;",
    );
    expect([...(await readFile(path.join(output, "node_modules/alpha/engine.wasm")))]).toEqual([
      0, 97, 115, 109,
    ]);
    await expect(
      readFile(path.join(output, "node_modules/unused/package.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      JSON.parse(await readFile(path.join(output, "package.json"), "utf8")).dependencies,
    ).toEqual({ alpha: "1.0.0", beta: "1.0.0" });

    await writeFile(path.join(output, "other-resource.txt"), "keep");
    await deploy_workspace_dependencies({
      root,
      output,
      names: manifest.workspaceRuntimePackages.backend,
      runNpm,
    });
    expect(await readFile(path.join(output, "other-resource.txt"), "utf8")).toBe("keep");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);

/** 创建可由 npm 查询和 Node 导入的自有包，验证真实依赖部署。 */
async function create_package(root, name, version, dependencies, code) {
  const directory = path.join(root, "node_modules", name);
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "package.json"),
    JSON.stringify({
      name,
      version,
      type: "module",
      exports: "./index.js",
      dependencies,
    }),
  );
  await writeFile(path.join(directory, "index.js"), code);
}
