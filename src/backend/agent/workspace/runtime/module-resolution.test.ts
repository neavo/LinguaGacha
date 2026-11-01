import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, it } from "vitest";

const electron =
  process.env.LINGUAGACHA_TEST_ELECTRON ?? (createRequire(import.meta.url)("electron") as string);
let root: string;
let application: string;
let shared: string;
let workspace: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "lg-resolution-中文 # "));
  application = path.join(root, "application");
  shared = path.join(root, "shared");
  workspace = path.join(root, "work");
  for (const directory of [application, shared, workspace]) {
    await mkdir(directory);
    await writeFile(path.join(directory, "package.json"), '{"type":"module"}');
  }
  await writeFile(
    path.join(root, "loader.mjs"),
    `import { install_workspace_module_resolution } from ${JSON.stringify(new URL("./module-resolution.ts", import.meta.url).href)};
     install_workspace_module_resolution(${JSON.stringify(application)}, ${JSON.stringify(shared)}, [${JSON.stringify(pathToFileURL(workspace + path.sep).href)}]);`,
  );
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it("ESM、CJS 与链接保留 Node 条件导出和包内嵌套依赖", async () => {
  await create_package(shared, "condition", {
    "index.mjs": "export default 'import';",
    "index.cjs": "module.exports = 'require';",
  });
  // 技能可以按相对路径加载包。包内依赖不能被工作材料的重定位规则接管。
  await create_package(workspace, "parent", {
    "index.mjs": "export { default } from 'condition';",
  });
  await create_package(path.join(workspace, "node_modules/parent"), "condition", {
    "index.mjs": "export default 'nested';",
  });
  const linked = path.join(root, "linked");
  await create_package(linked, "package", { "index.mjs": "export default 'linked';" });
  await symlink(
    path.join(linked, "node_modules/package"),
    path.join(shared, "node_modules/linked"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await writeFile(path.join(workspace, "require.cjs"), "module.exports = require('condition');");
  await run(`
    import esm from 'condition';
    import nested from './node_modules/parent/index.mjs';
    import linked from 'linked';
    import cjs from './require.cjs';
    assert.equal(esm, 'import');
    assert.equal(cjs, 'require');
    assert.equal(require('condition'), 'require');
    assert.equal(require.resolve('condition').endsWith('index.cjs'), true);
    assert.equal(nested, 'nested');
    assert.equal(linked, 'linked');
    assert.equal(require('linked').default, 'linked');
  `);
});

it("SDK 与第三方包各自选择安装根，缺失包不回退到用户或祖先目录", async () => {
  await create_package(application, "@lg/fixture", {
    "index.mjs": "export { default } from 'dependency';",
    "index.cjs": "module.exports = require('dependency');",
  });
  for (const [directory, value] of [
    [application, "application"],
    [shared, "user"],
  ] as const) {
    await create_package(directory, "dependency", {
      "index.mjs": `export default '${value}';`,
      "index.cjs": `module.exports = '${value}';`,
    });
  }
  await create_package(shared, "@lg/fixture", { "index.mjs": "throw new Error('shadowed');" });
  await create_package(shared, "consumer", {
    "index.mjs": "export { default } from '@lg/fixture';",
  });
  await create_package(shared, "@lg/user-only", { "index.mjs": "export default true;" });
  await create_package(application, "application-only", { "index.mjs": "export default true;" });
  for (const name of ["ancestor-only", "@lg/ancestor-only"])
    await create_package(root, name, { "index.mjs": "export default true;" });
  await run(`
    import sdk from '@lg/fixture';
    import consumer from 'consumer';
    import dependency from 'dependency';
    assert.equal(sdk, 'application');
    assert.equal(consumer, sdk);
    assert.equal(require('@lg/fixture'), 'application');
    assert.equal(dependency, 'user');
    for (const name of ['@lg/user-only', 'application-only', 'ancestor-only', '@lg/ancestor-only']) {
      await assert.rejects(import(name), { code: 'ERR_MODULE_NOT_FOUND' });
      assert.throws(() => require(name), { code: 'MODULE_NOT_FOUND' });
    }
  `);
});

/** 使用测试自有模块验证解析契约，包的内容由每个场景直接给出。 */
async function create_package(base: string, name: string, files: Record<string, string>) {
  const directory = path.join(base, "node_modules", name);
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "package.json"),
    JSON.stringify({
      name,
      type: "module",
      exports: {
        import: "./index.mjs",
        require: files["index.cjs"] ? "./index.cjs" : "./index.mjs",
      },
    }),
  );
  for (const [file, source] of Object.entries(files))
    await writeFile(path.join(directory, file), source);
}

/** 同步钩子影响整个进程。真实 Electron 子进程隔离每次加载及其模块缓存。 */
async function run(source: string) {
  const entry = path.join(workspace, "program.mjs");
  await writeFile(
    entry,
    `import assert from 'node:assert/strict';
     import { createRequire } from 'node:module';
     const require = createRequire(import.meta.url);
     ${source}`,
  );
  execFileSync(
    electron,
    [
      "--preserve-symlinks",
      "--preserve-symlinks-main",
      "--import",
      pathToFileURL(path.join(root, "loader.mjs")).href,
      entry,
    ],
    {
      cwd: workspace,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", NODE_OPTIONS: "" },
      windowsHide: true,
      timeout: 10_000,
    },
  );
}
