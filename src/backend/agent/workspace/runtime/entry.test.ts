import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "vite";
import { expect, it } from "vitest";

import { AGENT_WORKSPACE_CONTRACT } from "../contract";
import { AgentWorkspaceRunner } from "./runner";
import { project_path } from "../../../../../buildtools/vite/project-paths";

// Node 测试进程加载 electron 包得到可执行文件路径，Electron 自身的模块声明描述的是宿主 API。
const electron_path = createRequire(import.meta.url)("electron") as string;

it("生产 bundle 在 Electron Node 模式执行 JS、文件权限、IPC、网页读取与取消", async () => {
  const temporary_root = await mkdtemp(path.join(os.tmpdir(), "linguagacha-workspace-runtime-"));
  const server = createServer((request, response) => {
    if (request.url === "/redirect") {
      response.writeHead(302, { location: "/page" });
      response.end();
    } else {
      response.setHeader("Content-Type", "text/plain");
      response.end("page content");
    }
  });
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Missing server address");
    const url = `http://127.0.0.1:${address.port}/redirect`;
    const workspace_path = path.join(temporary_root, "workspace");
    const bundle_path = path.join(temporary_root, "bundle");
    await mkdir(workspace_path);
    await mkdir(path.join(workspace_path, "work"));
    await mkdir(path.join(workspace_path, "changes"));
    await writeFile(
      path.join(workspace_path, "contract.json"),
      JSON.stringify(AGENT_WORKSPACE_CONTRACT),
    );
    await writeFile(path.join(temporary_root, "outside.txt"), "outside");
    await build({
      configFile: project_path("buildtools/vite/workspace-runtime.vite.config.ts"),
      logLevel: "silent",
      build: { outDir: bundle_path },
    });
    expect(await readdir(bundle_path)).toEqual(["runtime.mjs"]);
    const runner = new AgentWorkspaceRunner({
      executablePath: electron_path,
      runtimeEntryPath: path.join(bundle_path, "runtime.mjs"),
      systemProxyResolver: {
        resolveProxy: async () => {
          throw new Error("proxy resolution reached host");
        },
      },
    });
    // 所有场景消费同一个真实进程入口，独立调用共享磁盘而不共享 JS 内存。
    const run = (script: string) =>
      runner.run({ workspacePath: workspace_path, script, todos: [] }, AbortSignal.timeout(10_000));
    await expect(
      run(`
      const fs = await import("node:fs/promises");
      const contract = JSON.parse(await fs.readFile("contract.json", "utf8"));
      await fs.writeFile("work/state.json", JSON.stringify({ value: 42 }));
      await fs.writeFile("changes/test.json", "{}");
      console.log("ordinary stdout", contract !== null);
      console.error("ordinary stderr");
      ws.todo.write(["核验结果"]);
      setInterval(() => {}, 1000);
      return 42;
    `),
    ).resolves.toEqual({ result: 42, todos: ["核验结果"] });
    await expect(
      run(
        'const fs = await import("node:fs/promises"); return JSON.parse(await fs.readFile("work/state.json", "utf8"));',
      ),
    ).resolves.toMatchObject({ result: { value: 42 } });
    for (const operation of [
      'readFile("../outside.txt", "utf8")',
      'writeFile("contract.json", "{}")',
      'writeFile("../outside.txt", "changed")',
    ]) {
      await expect(
        run(
          `const fs = await import("node:fs/promises"); try { await fs.${operation}; return "allowed"; } catch (error) { return error.code; }`,
        ),
      ).resolves.toMatchObject({ result: "ERR_ACCESS_DENIED" });
    }
    expect(await readFile(path.join(temporary_root, "outside.txt"), "utf8")).toBe("outside");
    await expect(
      run(`return await (await fetch(new Request(${JSON.stringify(url)}))).text();`),
    ).resolves.toMatchObject({ result: "page content" });
    await expect(
      run(`return (await fetch(${JSON.stringify(url)}, { redirect: "manual" })).status;`),
    ).resolves.toMatchObject({ result: 302 });
    await expect(run('return await fetch("https://example.invalid/page");')).rejects.toThrow(
      "proxy resolution reached host",
    );
    await expect(
      run(
        'const fs = await import("node:fs/promises"); await fs.writeFile("work/completed.txt", "kept"); throw new Error("script failed");',
      ),
    ).rejects.toThrow("script failed");
    expect(await readFile(path.join(workspace_path, "work/completed.txt"), "utf8")).toBe("kept");

    // 代理请求证明真实脚本已启动，再取消并等待 runner 完成进程回收。
    let notify_started!: () => void;
    const started = new Promise<void>((resolve) => {
      notify_started = resolve;
    });
    let proxy_signal: AbortSignal | undefined;
    const controller = new AbortController();
    const cancellable = new AgentWorkspaceRunner({
      executablePath: electron_path,
      runtimeEntryPath: path.join(bundle_path, "runtime.mjs"),
      systemProxyResolver: {
        resolveProxy: async (_url, signal) => {
          proxy_signal = signal;
          notify_started();
          return await new Promise<string>((_resolve, reject) =>
            signal?.addEventListener("abort", () => reject(signal.reason), { once: true }),
          );
        },
      },
    });
    const pending = cancellable.run(
      {
        workspacePath: workspace_path,
        script: 'await fetch("https://example.invalid/pending"); return null;',
        todos: [],
      },
      AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
    );
    const rejected = expect(pending).rejects.toThrow("stop");
    try {
      await Promise.race([started, pending]);
    } finally {
      controller.abort(new Error("stop"));
    }
    await rejected;
    expect(proxy_signal?.aborted).toBe(true);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(temporary_root, { recursive: true, force: true });
  }
}, 60_000);
