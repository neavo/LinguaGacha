import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { AGENT_WORKSPACE_CONTRACT } from "../contract";
import { AgentWorkspaceRunner, AgentWorkspaceRunError, type AgentWorkspaceOutput } from "./runner";
import { AGENT_WORKSPACE_RUN_ROOT, AGENT_WORKSPACE_RUNTIME_POLICY } from "./policy";

const electron_path =
  process.env.LINGUAGACHA_TEST_ELECTRON ?? (createRequire(import.meta.url)("electron") as string);
const RUN_TIMEOUT_MS = 3_000; // 早于测试超时回收子进程，失败后目录清理也能完成
let root = "";
let runtime = "";
let workspace = "";
let sequence = 0;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "linguagacha-node-"));
  runtime = path.join(root, "runtime");
  workspace = path.join(root, "workspace");
  const deployed = process.env.LINGUAGACHA_TEST_WORKSPACE_RUNTIME;
  if (deployed) await cp(deployed, runtime, { recursive: true });
  else
    execFileSync(process.execPath, [path.resolve("buildtools/build-workspace.mjs"), runtime], {
      windowsHide: true,
      stdio: "pipe",
    });
  await mkdir(path.join(workspace, AGENT_WORKSPACE_RUN_ROOT), { recursive: true });
  await mkdir(path.join(workspace, "changes"));
  for (const name of ["package.json", "package-lock.json"])
    await cp(path.join(runtime, name), path.join(workspace, name));
  await symlink(
    path.join(runtime, "node_modules"),
    path.join(workspace, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await writeFile(path.join(workspace, "contract.json"), JSON.stringify(AGENT_WORKSPACE_CONTRACT));
  await writeFile(path.join(root, "outside.txt"), "outside");
}, 60_000);

afterAll(async () => {
  if (workspace)
    await unlink(path.join(workspace, "node_modules")).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  if (root) await rm(root, { recursive: true, force: true });
});

it("独立部署目录支持原生模块、主程序身份、自然退出和异步 Todo", async () => {
  await mkdir(path.join(workspace, "work/scripts"));
  await writeFile(
    path.join(workspace, "work/scripts/helper.js"),
    "export const value = ws.todo.read()[0];",
  );
  await writeFile(path.join(workspace, "work/scripts/helper.cjs"), "module.exports = 42;");
  const result = await run(`
    import fs from 'node:fs/promises';
    import { fileURLToPath } from 'node:url';
    import value from '../scripts/helper.cjs';
    import { value as todo } from '../scripts/helper.js';
    await fs.writeFile('work/state.json', JSON.stringify(value));
    console.log(JSON.stringify({ main: fileURLToPath(import.meta.url) === process.argv[1], value, todo }));
    console.error('ordinary stderr');
    setTimeout(() => { console.log('async finished'); ws.todo.write(['核验结果']); }, 10);
    export default 1n;
  `);
  expect(result.execution).toMatchObject({
    exitCode: 0,
    signal: null,
    stderr: { content: "ordinary stderr\n" },
  });
  expect(output_content(result.execution.stdout)).toBe(
    '{"main":true,"value":42,"todo":"发现目标"}\nasync finished\n',
  );
  expect(result.todos).toEqual(["核验结果"]);
  expect(await readFile(path.join(workspace, result.execution.stdout.path), "utf8")).toBe(
    output_content(result.execution.stdout),
  );
  expect(
    (
      await run(
        "import fs from 'node:fs/promises'; console.log(await fs.readFile('work/state.json', 'utf8')); ",
      )
    ).execution.stdout,
  ).toMatchObject({ content: "42\n" });
  const empty = await run("// 没有输出的普通程序也成功");
  expect(empty.execution.exitCode).toBe(0);
  for (const output of [empty.execution.stdout, empty.execution.stderr]) {
    expect(output).toMatchObject({ bytes: 0, content: "" });
    expect(await readFile(path.join(workspace, output.path), "utf8")).toBe("");
  }
});

it("超额输出完整落盘，主动错误输出与未捕获异常都保留", async () => {
  const limit = AGENT_WORKSPACE_RUNTIME_POLICY.inlineOutputBytes;
  let error: unknown;
  try {
    await run(`
      process.stdout.write('x'.repeat(${limit}) + 'END');
      process.stderr.write('y'.repeat(${limit}));
      console.error('manual error');
      throw new Error('automatic error');
    `);
  } catch (cause) {
    error = cause;
  }
  if (!(error instanceof AgentWorkspaceRunError))
    throw error ?? new Error("Expected program failure");
  expect(error.execution.exitCode).toBe(1);
  for (const output of [error.execution.stdout, error.execution.stderr]) {
    expect(output.bytes).toBeGreaterThan(limit);
    expect(output).not.toHaveProperty("content");
    expect(output).toHaveProperty("message");
  }
  const stdout = await readFile(path.join(workspace, error.execution.stdout.path), "utf8");
  const stderr = await readFile(path.join(workspace, error.execution.stderr.path), "utf8");
  expect(stdout.length).toBe(limit + 3);
  expect(stdout.endsWith("END")).toBe(true);
  expect(stderr).toContain("manual error");
  expect(stderr).toContain("Error: automatic error");
});

it("原生 npm 子路径、网页流与代理等待在真实子进程中工作", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/redirect") {
      response.writeHead(302, { location: "/page" });
      response.end();
    } else {
      response.setHeader("Content-Type", "text/html");
      response.end('<article><h1>Hello</h1><p><a href="/target">世界</a></p></article>');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Missing server address");
  const url = `http://127.0.0.1:${address.port}/redirect`;
  try {
    const result = await run(`
      import { htmlToMarkdown, streamHtmlToMarkdown } from '@mdream/js/core';
      import { isolateMainPlugin } from '@mdream/js/plugins';
      const response = await fetch(${JSON.stringify(url)});
      const text = htmlToMarkdown(await response.text(), { origin: response.url, plugins: [isolateMainPlugin()] });
      const streamed = await fetch(${JSON.stringify(url)});
      let markdown = '';
      for await (const chunk of streamHtmlToMarkdown(streamed.body, { origin: streamed.url })) markdown += chunk;
      console.log(JSON.stringify({ text, markdown }));
    `);
    const output = output_content(result.execution.stdout) as { text: string; markdown: string };
    for (const text of Object.values(output)) {
      expect(text).toContain("# Hello");
      expect(text).toContain(`http://127.0.0.1:${address.port}/target`);
    }
    // 先收到代理请求，再返回错误；等待宿主期间 IPC 必须维持子进程存活。
    let release!: (rules: string) => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const proxy = new Promise<string>((resolve) => {
      release = resolve;
    });
    const pending = run(
      "try { await fetch('https://example.invalid'); } catch (error) { console.log(error.message); }",
      undefined,
      async () => {
        started();
        return await proxy;
      },
    );
    await ready;
    release("UNSUPPORTED");
    expect(output_content((await pending).execution.stdout)).toContain(
      "System proxy returned no supported route",
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it("权限保护部署与快照，失败保留输出、位置和已写文件", async () => {
  const result = await run(`
    import fs from 'node:fs/promises';
    const failures = [];
    for (const operation of [
      () => fs.readFile('../outside.txt'),
      () => fs.writeFile('contract.json', '{}'),
      () => fs.writeFile('package.json', '{}'),
      () => fs.writeFile('node_modules/@mdream/js/package.json', '{}'),
    ]) { try { await operation(); } catch (error) { failures.push(error.code); } }
    console.log(JSON.stringify(failures));
  `);
  expect(output_content(result.execution.stdout)).toEqual(Array(4).fill("ERR_ACCESS_DENIED"));
  await expect(
    run(
      `import fs from 'node:fs/promises'; await fs.writeFile('work/kept.txt','kept'); console.log('before error'); throw new Error('program failed');`,
    ),
  ).rejects.toMatchObject({
    execution: {
      exitCode: 1,
      stdout: { content: "before error\n" },
      stderr: { content: expect.stringContaining("program failed") },
    },
  });
  expect(await readFile(path.join(workspace, "work/kept.txt"), "utf8")).toBe("kept");
  await expect(
    run('console.error(JSON.stringify({ message: "intentional exit" })); process.exitCode = 7;'),
  ).rejects.toMatchObject({
    execution: { exitCode: 7, stderr: { content: { message: "intentional exit" } } },
  });
  expect((await run("process.exit(0);")).execution.exitCode).toBe(0);
});

it("取消在途代理等待后回收进程，并解除宿主请求", async () => {
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  let proxy_signal: AbortSignal | undefined;
  const controller = new AbortController();
  const pending = run(
    "console.log('before wait'); await fetch('https://example.invalid/pending');",
    controller.signal,
    async (_url, signal) => {
      proxy_signal = signal;
      started();
      return await new Promise<string>((_resolve, reject) =>
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true }),
      );
    },
  );
  const rejected = expect(pending).rejects.toThrow("stop");
  try {
    await Promise.race([ready, pending]);
  } finally {
    controller.abort(new Error("stop"));
  }
  await rejected;
  expect(proxy_signal?.aborted).toBe(true);
  expect(
    await readFile(
      path.join(workspace, `${AGENT_WORKSPACE_RUN_ROOT}/task-${sequence}.stdout.log`),
      "utf8",
    ),
  ).toBe("before wait\n");
});

it.each([false, true])(
  "工作区祖先、部署目录及可写挂载支持链接（work 本身链接：%s）",
  async (mount_work) => {
    const directory = await mkdtemp(path.join(root, "linked-"));
    const data = path.join(directory, "data");
    const data_link = path.join(directory, "data-link");
    const runtime_link = path.join(directory, "runtime-link");
    const actual_workspace = path.join(data, "agent", "workspace");
    const logical_workspace = path.join(data_link, "agent", "workspace");
    const external = path.join(directory, "external");
    const link_type = process.platform === "win32" ? "junction" : "dir";
    await mkdir(actual_workspace, { recursive: true });
    await mkdir(external);
    await symlink(data, data_link, link_type);
    await symlink(runtime, runtime_link, link_type);
    try {
      if (mount_work) await symlink(external, path.join(logical_workspace, "work"), link_type);
      else await mkdir(path.join(logical_workspace, "work"));
      await mkdir(path.join(logical_workspace, "changes"));
      await symlink(
        path.join(runtime, "node_modules"),
        path.join(logical_workspace, "node_modules"),
        link_type,
      );
      await symlink(external, path.join(logical_workspace, "work", "output"), link_type);
      await writeFile(path.join(external, "helper.mjs"), "export const title = 'linked';");
      await writeFile(
        path.join(logical_workspace, "contract.json"),
        JSON.stringify(AGENT_WORKSPACE_CONTRACT),
      );
      await cp(path.join(runtime, "package.json"), path.join(logical_workspace, "package.json"));
      await mkdir(path.join(logical_workspace, AGENT_WORKSPACE_RUN_ROOT), { recursive: true });
      const scriptPath = `${AGENT_WORKSPACE_RUN_ROOT}/task.mjs`;
      await writeFile(
        path.join(logical_workspace, scriptPath),
        `
      import fs from 'node:fs/promises';
      import { htmlToMarkdown } from '@mdream/js/core';
      import { title } from '../output/helper.mjs';
      const text = htmlToMarkdown('<h1>' + title + '</h1>');
      await fs.writeFile('work/output/result.md', text);
      await fs.writeFile('changes/result.json', JSON.stringify({title}));
      console.log(await fs.readFile('work/output/result.md', 'utf8'));
    `,
      );
      const result = await new AgentWorkspaceRunner({
        executablePath: electron_path,
        runtimeBootstrapPath: path.join(runtime_link, "bootstrap.mjs"),
        systemProxyResolver: { resolveProxy: async () => "DIRECT" },
      }).run(
        {
          workspacePath: logical_workspace,
          scriptPath,
          stdoutPath: `${AGENT_WORKSPACE_RUN_ROOT}/task.stdout.log`,
          stderrPath: `${AGENT_WORKSPACE_RUN_ROOT}/task.stderr.log`,
          todos: [],
        },
        AbortSignal.timeout(RUN_TIMEOUT_MS),
      );
      expect(result.execution.exitCode).toBe(0);
      expect(output_content(result.execution.stdout)).toMatch(/^# linked\s*$/u);
      expect(await readFile(path.join(external, "result.md"), "utf8")).toContain("# linked");
      expect(
        JSON.parse(await readFile(path.join(actual_workspace, "changes/result.json"), "utf8")),
      ).toEqual({ title: "linked" });
    } finally {
      await unlink(data_link);
      await unlink(runtime_link);
    }
  },
);

/** 保存真实 ESM 文件并通过生产 runner 观察进程结果。 */
async function run(
  script: string,
  signal: AbortSignal = AbortSignal.timeout(RUN_TIMEOUT_MS),
  resolveProxy: (url: string, signal?: AbortSignal) => Promise<string> = async () => "DIRECT",
) {
  const scriptPath = `${AGENT_WORKSPACE_RUN_ROOT}/task-${++sequence}.mjs`;
  await writeFile(path.join(workspace, scriptPath), script);
  return await new AgentWorkspaceRunner({
    executablePath: electron_path,
    runtimeBootstrapPath: path.join(runtime, "bootstrap.mjs"),
    systemProxyResolver: { resolveProxy },
  }).run(
    {
      workspacePath: workspace,
      scriptPath,
      stdoutPath: `${AGENT_WORKSPACE_RUN_ROOT}/task-${sequence}.stdout.log`,
      stderrPath: `${AGENT_WORKSPACE_RUN_ROOT}/task-${sequence}.stderr.log`,
      todos: ["发现目标"],
    },
    signal,
  );
}

/** 本场景期待额度内的完整输出。 */
function output_content(output: AgentWorkspaceOutput) {
  if (!("content" in output)) throw new Error(output.message);
  return output.content;
}
