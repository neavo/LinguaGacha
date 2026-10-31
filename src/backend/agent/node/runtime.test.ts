import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile, unlink } from "node:fs/promises";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import npm_package from "npm/package.json";
import { AgentNodeRuntime, AgentNodeExecError } from "./runtime";

const electron =
  process.env.LINGUAGACHA_TEST_ELECTRON ?? (createRequire(import.meta.url)("electron") as string);
let root = "";
let runtime = "";
let tarball = "";
let sequence = 0;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "lg-npm-中文 空格-"));
  runtime = path.join(root, "resources/workspace");
  if (process.env.LINGUAGACHA_TEST_WORKSPACE_RUNTIME)
    await cp(process.env.LINGUAGACHA_TEST_WORKSPACE_RUNTIME, runtime, { recursive: true });
  else
    execFileSync(
      process.execPath,
      [path.resolve("buildtools/resources/build.mjs"), path.dirname(runtime), "--development"],
      {
        windowsHide: true,
        stdio: "pipe",
      },
    );
  const pkg = path.join(root, "fixture");
  await mkdir(pkg);
  await writeFile(
    path.join(pkg, "package.json"),
    JSON.stringify({ name: "lg-cli-fixture", version: "1.0.0", bin: { "lg-fixture": "cli.cjs" } }),
  );
  await writeFile(
    path.join(pkg, "cli.cjs"),
    `#!/usr/bin/env node
const {spawn,spawnSync}=require('node:child_process');
const fs=require('node:fs');
if(process.argv[2]==='wait') {
  const child=spawn('node',['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
  fs.writeFileSync(process.argv[3],JSON.stringify([process.pid,child.pid]));
  setInterval(()=>{},1000);
} else {
  const node=spawnSync('node',['-e','console.log("nested node")'],{encoding:'utf8'});
  const npm=spawnSync(process.platform==='win32'?'npm.cmd':'npm',['--version'],{shell:process.platform==='win32',encoding:'utf8'});
  const npx=spawnSync(process.platform==='win32'?'npx.cmd':'npx',['--version'],{shell:process.platform==='win32',encoding:'utf8'});
  console.log(JSON.stringify({args:process.argv.slice(2),node:[node.status,node.stdout.trim()],npm:[npm.status,npm.stdout.trim()],npx:[npx.status,npx.stdout.trim()]}));
}
`,
  );
  const packed = JSON.parse(
    execFileSync(
      electron,
      [path.join(runtime, "npm/bin/npm-cli.js"), "pack", "--json", "--ignore-scripts"],
      {
        cwd: pkg,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", NODE_OPTIONS: "" },
        windowsHide: true,
      },
    ).toString(),
  );
  tarball = path.join(pkg, packed["lg-cli-fixture"].filename);
}, 60_000);

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

function create_runtime(
  name: string,
  resolveProxy: (url: string) => Promise<string> = async () => "DIRECT",
) {
  const shared = path.join(root, name, "node");
  const workspace = path.join(root, name, "workspace");
  return {
    shared,
    workspace,
    node: new AgentNodeRuntime({
      runtimeDirectory: runtime,
      executablePath: electron,
      electronVersion: "45.0.0",
      paths: {
        get_agent_node_root_dir: () => shared,
        get_agent_node_lock_path: () => path.join(root, name, "node.lock"),
      },
      proxyResolver: { resolveProxy },
    }),
  };
}

it("真实 npm 默认采用应用代理，显式参数和 npmrc 保留原生优先级", async () => {
  const servers: http.Server[] = [];
  const start_registry = async (version: string) => {
    const server = http.createServer((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          name: "lg-registry-test",
          "dist-tags": { latest: version },
          versions: { [version]: { name: "lg-registry-test", version } },
        }),
      );
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Invalid registry address");
    return address.port;
  };
  const application = await start_registry("1.0.0");
  const explicit = await start_registry("2.0.0");
  const fixture = create_runtime("proxy", async () => `PROXY user:secret@127.0.0.1:${application}`);
  const command =
    "npm view lg-registry-test version --registry=http://registry.example --fetch-retries=0 --no-update-notifier";
  try {
    expect((await execute(fixture, command)).stdout).toMatchObject({ content: "1.0.0\n" });
    expect(
      (await execute(fixture, `${command} --proxy=http://127.0.0.1:${explicit}`)).stdout,
    ).toMatchObject({ content: "2.0.0\n" });
    await execute(fixture, `npm config set proxy http://127.0.0.1:${explicit}`);
    expect((await execute(fixture, command)).stdout).toMatchObject({ content: "2.0.0\n" });
  } finally {
    await fixture.node.close();
    for (const server of servers) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
}, 30_000);

function execute(
  fixture: ReturnType<typeof create_runtime>,
  command: string,
  signal = AbortSignal.timeout(20_000),
) {
  const id = ++sequence;
  return fixture.node.run_exec(
    { workspacePath: fixture.workspace, command, stdoutPath: `${id}.out`, stderrPath: `${id}.err` },
    signal,
  );
}

it("发布种子符合工作区运行资源边界", async () => {
  const modules = path.join(runtime, "seed/node_modules");
  const workspace = JSON.parse(
    await readFile(path.join(modules, "@lg/workspace/package.json"), "utf8"),
  );
  expect(workspace.exports).not.toHaveProperty("./bootstrap");
  expect(workspace.exports).not.toHaveProperty("./prepare");
  expect(fs.existsSync(path.join(modules, "@lg/workspace/bootstrap.mjs"))).toBe(false);
  expect(fs.existsSync(path.join(modules, "@lg/workspace/prepare.mjs"))).toBe(false);
  for (const file of [
    "exceljs/dist",
    "mupdf/dist/mupdf-wasm.wasm.br",
    "@lg/pdf/node_modules/mupdf/dist/mupdf-wasm.wasm.br",
  ]) {
    expect(fs.existsSync(path.join(modules, file))).toBe(false);
  }
  for (const file of [
    "exceljs/index.d.ts",
    "mupdf/dist/mupdf-wasm.wasm",
    "@lg/pdf/node_modules/mupdf/dist/mupdf-wasm.wasm",
  ]) {
    expect(fs.existsSync(path.join(modules, file))).toBe(true);
  }
});

it("搬移种子离线首用，npm/npx 和无 shell Node 均使用应用解释器", async () => {
  const fixture = create_runtime("offline");
  const path_key = Object.keys(process.env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  vi.stubEnv(path_key, "");
  try {
    await execute(
      fixture,
      `npm install --offline --ignore-scripts --no-audit --no-fund "${tarball.replaceAll("\\", "/")}"`,
    );
    const result = await execute(
      fixture,
      'npm exec --offline -- lg-fixture "中文 空格" "a\\\"b" ""',
    );
    expect(result.stdout).toMatchObject({
      content: {
        args: ["中文 空格", 'a"b', ""],
        node: [0, "nested node"],
        npm: [0, npm_package.version],
        npx: [0, npm_package.version],
      },
    });
  } finally {
    vi.unstubAllEnvs();
    await fixture.node.close();
  }
}, 30_000);

it("应用包修复保留用户依赖与配置，缺失清单可由 npm 原生恢复", async () => {
  const fixture = create_runtime("repair");
  try {
    expect((await execute(fixture, "npm config get cache")).stdout).toMatchObject({
      content: `${path.join(fixture.shared, "cache")}\n`,
    });
    await execute(fixture, "npm pkg set custom=keep");
    await execute(fixture, "npm uninstall --offline --ignore-scripts --no-audit --no-fund chardet");
    const cache = path.join(root, "custom cache");
    await execute(fixture, `npm config set cache "${cache.replaceAll("\\", "/")}"`);
    expect((await execute(fixture, "npm config get cache")).stdout).toMatchObject({
      content: `${cache}\n`,
    });
    const config = await readFile(path.join(fixture.shared, "npmrc"), "utf8");
    await rm(path.join(fixture.shared, "node_modules/@lg/text"), { recursive: true });
    await rm(path.join(fixture.shared, "node_modules/@lg/pdf"), { recursive: true });
    const repaired = await fixture.node.with_environment(
      { workspacePath: fixture.workspace, stdoutPath: "prepare.out", stderrPath: "prepare.err" },
      AbortSignal.timeout(20_000),
      "run",
      async (owner, env, signal) =>
        await owner.launch(
          {
            executable: electron,
            args: [
              "--input-type=module",
              "-e",
              "import {render_pdf_page} from '@lg/pdf'; console.log(typeof render_pdf_page);",
            ],
            cwd: fixture.shared,
            env,
            stdout: path.join(fixture.workspace, "repaired.out"),
            stderr: path.join(fixture.workspace, "repaired.err"),
          },
          signal,
        ),
    );
    expect(repaired.exitCode).toBe(0);
    expect(await readFile(path.join(fixture.workspace, "repaired.out"), "utf8")).toBe("function\n");
    const manifest = JSON.parse(await readFile(path.join(fixture.shared, "package.json"), "utf8"));
    expect(manifest.custom).toBe("keep");
    expect(manifest.dependencies.chardet).toBeUndefined();
    expect(await readFile(path.join(fixture.shared, "npmrc"), "utf8")).toBe(config);
    expect(
      JSON.parse(
        await readFile(path.join(fixture.shared, "node_modules/@lg/text/package.json"), "utf8"),
      ).version,
    ).toMatch(/^0\.0\.0-lg\.h/u);
    await writeFile(
      path.join(root, "repair/package.json"),
      JSON.stringify({ name: "parent-sentinel" }),
    );
    await unlink(path.join(fixture.shared, "package.json"));
    expect((await execute(fixture, "npm prefix")).stdout).toMatchObject({
      content: `${fixture.shared}\n`,
    });
    await execute(fixture, "npm init --yes");
    expect(JSON.parse(await readFile(path.join(root, "repair/package.json"), "utf8"))).toEqual({
      name: "parent-sentinel",
    });
  } finally {
    await fixture.node.close();
  }
}, 30_000);

it("跨实例互斥覆盖取消和后代回收，失败保留日志并允许下一次执行", async () => {
  const fixture = create_runtime("cancel");
  const other = create_runtime("cancel");
  try {
    await execute(
      fixture,
      `npm install --offline --ignore-scripts --no-audit --no-fund "${tarball.replaceAll("\\", "/")}"`,
    );
    const marker = path.join(fixture.workspace, "pids.json");
    const controller = new AbortController();
    const pending = execute(
      fixture,
      `npm exec --offline -- lg-fixture wait "${marker.replaceAll("\\", "/")}"`,
      controller.signal,
    );
    const stopped = new Error("stop npm");
    const outcome = pending.catch((error: unknown) => error);
    await vi.waitFor(() => expect(fs.existsSync(marker)).toBe(true));
    await expect(execute(other, "npm --version")).rejects.toMatchObject({ code: "runtime.busy" });
    controller.abort(stopped);
    expect(await outcome).toBe(stopped);
    const pids: number[] = JSON.parse(await readFile(marker, "utf8"));
    for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
    expect((await execute(other, "npm --version")).stdout).toMatchObject({
      content: `${npm_package.version}\n`,
    });
    await expect(execute(other, "npm definitely-not-a-command")).rejects.toBeInstanceOf(
      AgentNodeExecError,
    );
  } finally {
    await fixture.node.close();
    await other.node.close();
  }
}, 30_000);

it("准备阶段回收中断暂存材料，已初始化的用户文件继续保留", async () => {
  const fixture = create_runtime("interrupted-prepare");
  const staging = `${fixture.shared}.prepare`;
  try {
    for (const initialized of [false, true]) {
      await mkdir(path.join(staging, "seed"), { recursive: true });
      await writeFile(path.join(staging, "seed/partial"), "interrupted copy");
      if (initialized) await writeFile(path.join(fixture.shared, "user.txt"), "keep");
      await execute(fixture, "npm --version");
      expect(fs.existsSync(staging)).toBe(false);
      expect(fs.existsSync(path.join(fixture.shared, "partial"))).toBe(false);
      if (initialized)
        expect(await readFile(path.join(fixture.shared, "user.txt"), "utf8")).toBe("keep");
    }
  } finally {
    await fixture.node.close();
  }
}, 30_000);
