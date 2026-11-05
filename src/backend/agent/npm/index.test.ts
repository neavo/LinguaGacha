import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { inject, afterAll, beforeAll, expect, it, vi } from "vitest";
import npm_package from "npm/package.json";
import type { AgentProcessOutput } from "../process-output";
import { AgentExecutionRuntime } from "../execution/runtime";
import { AgentWorkspaceRunner } from "../workspace/runtime/runner";
import { AGENT_WORKSPACE_RUN_ROOT } from "../workspace/runtime/policy";
import { AGENT_WORKSPACE_CONTRACT } from "../tools/contract";

const electron =
  process.env.LINGUAGACHA_TEST_ELECTRON ?? (createRequire(import.meta.url)("electron") as string);
let root = "";
let runtime = "";
let tarball = "";
let sequence = 0;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "lg-npm-中文 空格-"));
  runtime = inject("workspaceRuntimeDirectory");
  const pkg = path.join(root, "fixture");
  await mkdir(pkg);
  await writeFile(
    path.join(pkg, "package.json"),
    JSON.stringify({
      name: "lg-cli-fixture",
      version: "1.0.0",
      main: "index.cjs",
      bin: { "lg-fixture": "cli.cjs" },
    }),
  );
  await writeFile(path.join(pkg, "index.cjs"), "module.exports = 'installed';");
  await writeFile(
    path.join(pkg, "cli.cjs"),
    `#!/usr/bin/env node
const {spawn,spawnSync}=require('node:child_process');
const fs=require('node:fs');
const [mode,file,label,delay]=process.argv.slice(2);
if(mode==='wait') {
  const child=spawn('node',['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
  fs.writeFileSync(file,JSON.stringify([process.pid,child.pid]));
  setInterval(()=>{},1000);
} else if(mode==='orphan') {
  const child=spawn('node',['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
  child.unref();
  fs.writeFileSync(file,JSON.stringify([child.pid]));
} else if(mode==='log') {
  fs.appendFileSync(file,'start '+label+'\\n');
  setTimeout(()=>fs.appendFileSync(file,'end '+label+'\\n'),Number(delay));
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

/** 每个场景拥有独立用户工程与工作区，同名场景共享跨实例锁。 */
async function create_fixture(
  name: string,
  resolveProxy: (url: string) => Promise<string> = async () => "DIRECT",
) {
  const shared = path.join(root, name, "node");
  const workspace = path.join(root, name, "workspace");
  await mkdir(path.join(workspace, AGENT_WORKSPACE_RUN_ROOT), { recursive: true });
  await writeFile(path.join(workspace, "contract.json"), JSON.stringify(AGENT_WORKSPACE_CONTRACT));
  const execution = new AgentExecutionRuntime({
    runtimeDirectory: runtime,
    executablePath: electron,
    electronVersion: "45.0.0",
    paths: {
      get_agent_node_root_dir: () => shared,
      get_agent_python_root_dir: () => path.join(root, "python"),
      get_agent_execution_lock_path: () => path.join(root, name, "node.lock"),
    },
    proxyResolver: { resolveProxy },
  });
  const runner = new AgentWorkspaceRunner({
    execution,
    proxyResolver: { resolveProxy },
    paths: {
      get_agent_user_skill_dir: () => path.join(root, name, "skills"),
      get_agent_builtin_skill_dir: () => path.join(root, name, "builtin"),
    },
  });
  /** 真实 bootstrap 启动根脚本，脚本已导入 `npm` 与 `path`。 */
  const run = async (script: string, signal = AbortSignal.timeout(20_000)) => {
    const id = ++sequence;
    const base = `${AGENT_WORKSPACE_RUN_ROOT}/npm-${id}`;
    await writeFile(
      path.join(workspace, `${base}.mjs`),
      `import { npm } from "@lg/npm";\nimport path from "node:path";\n${script}`,
    );
    return await runner.run(
      {
        workspacePath: workspace,
        scriptPath: `${base}.mjs`,
        stdoutPath: `${base}.stdout.log`,
        stderrPath: `${base}.stderr.log`,
        timeoutMs: 60_000,
      },
      signal,
    );
  };
  // 后续场景从共享工程调用的测试 CLI。
  const install_fixture = () =>
    run(
      `await npm.run(["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", ${JSON.stringify(tarball)}]);`,
    );
  return { shared, workspace, execution, run, install_fixture };
}

/** 本文件场景都期待额度内的完整输出。 */
function content(output: AgentProcessOutput) {
  if (!("content" in output)) throw new Error(output.message);
  return output.content;
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
  const fixture = await create_fixture(
    "proxy",
    async () => `PROXY user:secret@127.0.0.1:${application}`,
  );
  try {
    const result = await fixture.run(`
      const view = ["view", "lg-registry-test", "version", "--registry=http://registry.example", "--fetch-retries=0", "--no-update-notifier"];
      await npm.run(view);
      await npm.run([...view, "--proxy=http://127.0.0.1:${explicit}"]);
      await npm.run(["config", "set", "proxy", "http://127.0.0.1:${explicit}"]);
      await npm.run(view);
    `);
    expect(content(result.stdout)).toBe("1.0.0\n2.0.0\n2.0.0\n");
  } finally {
    await fixture.execution.close();
    for (const server of servers) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
}, 30_000);

it("离线安装后下一次调用可导入，argv 原样传递，npm/npx 和无 shell Node 使用应用解释器", async () => {
  const fixture = await create_fixture("offline");
  const path_key = Object.keys(process.env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  vi.stubEnv(path_key, "");
  try {
    await fixture.install_fixture();
    const args = ["中文 空格", 'a"b', "", "C:\\back\\slash"];
    const result = await fixture.run(`
      await npm.run(["exec", "--offline", "--", "lg-fixture", ...${JSON.stringify(args)}]);
    `);
    expect(content(result.stdout)).toEqual({
      args,
      node: [0, "nested node"],
      npm: [0, npm_package.version],
      npx: [0, npm_package.version],
    });
    const imported = await fixture.run(
      `const { default: value } = await import("lg-cli-fixture"); console.log(value);`,
    );
    expect(content(imported.stdout)).toBe("installed\n");
  } finally {
    vi.unstubAllEnvs();
    await fixture.execution.close();
  }
}, 60_000);

it("调用按顺序排队，失败不阻断后续调用，未捕获失败使执行失败并保留 npm 日志", async () => {
  const fixture = await create_fixture("queue");
  try {
    await fixture.install_fixture();
    const order = path.join(fixture.workspace, "order.log");
    const error: unknown = await fixture
      .run(
        `
      import assert from "node:assert/strict";
      await assert.rejects(npm.run("--version"), TypeError);
      const log = (label, delay) => ["exec", "--offline", "--", "lg-fixture", "log", ${JSON.stringify(order)}, label, delay];
      const args = log("a", "300");
      const calls = [npm.run(args), npm.run(["definitely-not-a-command"]), npm.run(log("b", "0"))];
      args[6] = "changed"; // 已受理的调用不受后续修改影响。
      const results = await Promise.allSettled(calls);
      console.log(JSON.stringify(results.map((result) => result.status)));
      await npm.run(["definitely-not-a-command"]);
    `,
      )
      .catch((error: unknown) => error);
    expect(await readFile(order, "utf8")).toBe("start a\nend a\nstart b\nend b\n");
    const { execution } = error as {
      execution: { exitCode: number; stdout: AgentProcessOutput; stderr: AgentProcessOutput };
    };
    expect(execution.exitCode).toBe(1);
    // npm 自身的失败输出与脚本输出按调用顺序进入同一日志。
    expect(String(content(execution.stdout))).toMatch(
      /Unknown command: "definitely-not-a-command"[\s\S]*\["fulfilled","rejected","fulfilled"\][\s\S]*Unknown command/u,
    );
    expect(String(content(execution.stderr))).toContain("npm failed (exitCode=1");
  } finally {
    await fixture.execution.close();
  }
}, 60_000);

it("环境准备保留用户依赖与配置，清单缺失或损坏时可经 SDK 恢复", async () => {
  const fixture = await create_fixture("repair");
  const manifest_path = path.join(fixture.shared, "package.json");
  const read_manifest = async () => JSON.parse(await readFile(manifest_path, "utf8"));
  try {
    await fixture.install_fixture();
    const cache = path.join(root, "custom cache");
    const configured = await fixture.run(`
      await npm.run(["config", "get", "cache"]);
      await npm.run(["pkg", "set", "custom=keep"]);
      await npm.run(["uninstall", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--silent", "lg-cli-fixture"]);
      await npm.run(["config", "set", "cache", ${JSON.stringify(cache)}]);
      await npm.run(["config", "get", "cache"]);
    `);
    expect(content(configured.stdout)).toBe(`${path.join(fixture.shared, "cache")}\n${cache}\n`);
    const config = await readFile(path.join(fixture.shared, "npmrc"), "utf8");
    const historical = path.join(fixture.shared, "node_modules/@lg/text");
    await mkdir(historical, { recursive: true });
    await writeFile(path.join(historical, "package.json"), '{"version":"old"}');
    await fixture.run("// 再次准备环境。");
    expect(await readFile(path.join(historical, "package.json"), "utf8")).toBe('{"version":"old"}');
    expect(await read_manifest()).toMatchObject({ custom: "keep" });
    expect((await read_manifest()).dependencies["lg-cli-fixture"]).toBeUndefined();
    expect(await readFile(path.join(fixture.shared, "npmrc"), "utf8")).toBe(config);

    await writeFile(manifest_path, "{ broken");
    await fixture.run(`
      import assert from "node:assert/strict";
      import { readFile, writeFile } from "node:fs/promises";
      const file = path.join(npm.directory, "package.json");
      assert.equal(await readFile(file, "utf8"), "{ broken");
      await assert.rejects(npm.run(["pkg", "set", "after=repair"]));
      await writeFile(file, JSON.stringify({ custom: "fixed" }));
      await npm.run(["pkg", "set", "after=repair"]);
    `);
    expect(await read_manifest()).toEqual({ custom: "fixed", after: "repair" });

    const parent = path.join(root, "repair/package.json");
    await writeFile(parent, JSON.stringify({ name: "parent-sentinel" }));
    await unlink(manifest_path);
    const prefix = await fixture.run('await npm.run(["prefix"]);');
    expect(content(prefix.stdout)).toBe(`${fixture.shared}\n`);
    await fixture.run('await npm.run(["init", "--yes"]);');
    expect(fs.existsSync(manifest_path)).toBe(true);
    expect(JSON.parse(await readFile(parent, "utf8"))).toEqual({ name: "parent-sentinel" });
  } finally {
    await fixture.execution.close();
  }
}, 60_000);

it("npm 后代在根脚本结束或取消时回收，共享租约随后可重新取得", async () => {
  const fixture = await create_fixture("cancel");
  const pids = async (file: string): Promise<number[]> => JSON.parse(await readFile(file, "utf8"));
  try {
    await fixture.install_fixture();
    const orphan = path.join(fixture.workspace, "orphan.json");
    await fixture.run(
      `await npm.run(["exec", "--offline", "--", "lg-fixture", "orphan", ${JSON.stringify(orphan)}]);`,
    );
    for (const pid of await pids(orphan)) expect(() => process.kill(pid, 0)).toThrow();

    const marker = path.join(fixture.workspace, "pids.json");
    const controller = new AbortController();
    const stopped = new Error("stop npm");
    const outcome = fixture
      .run(
        `await npm.run(["exec", "--offline", "--", "lg-fixture", "wait", ${JSON.stringify(marker)}]);`,
        controller.signal,
      )
      .catch((error: unknown) => error);
    await vi.waitFor(() => expect(fs.existsSync(marker)).toBe(true), { timeout: 15_000 });
    controller.abort(stopped);
    expect(await outcome).toBe(stopped);
    for (const pid of await pids(marker)) expect(() => process.kill(pid, 0)).toThrow();
    expect(content((await fixture.run('await npm.run(["--version"]);')).stdout)).toBe(
      `${npm_package.version}\n`,
    );
  } finally {
    await fixture.execution.close();
  }
}, 60_000);
