import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { GuiBackendBootstrap } from "./gui-backend-bootstrap";

const cleanup_roots: string[] = [];

afterEach(() => {
  while (cleanup_roots.length > 0) {
    const root = cleanup_roots.pop();
    if (root !== undefined) fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("GuiBackendBootstrap 集成", () => {
  it("启动真实 Agent 与 Gateway，并从公开 API 读取运行快照", async () => {
    const app_root = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-gui-backend-"));
    cleanup_roots.push(app_root);
    fs.writeFileSync(path.join(app_root, "version.txt"), "1.2.3", "utf8");
    const bootstrap = new GuiBackendBootstrap({
      appRoot: app_root,
      builtinRoot: path.resolve(process.cwd(), "builtin"),
      logTargets: { console: false, window: false },
      systemProxyResolver: { resolveProxy: async () => "DIRECT" },
      agentWebFetch: async (url) => ({
        url,
        contentType: "text/plain",
        body: new Uint8Array(),
      }),
      agentWorkspaceRun: async (request) => ({ result: null, todos: [...request.todos] }),
      openOutputFolder: async () => undefined,
      workerExecution: { kind: "in_process" },
    });

    try {
      const started = await bootstrap.start();
      const health = await fetch(`${started.apiBaseUrl}/api/health`);
      const agent = await fetch(`${started.apiBaseUrl}/api/agent/snapshot`);

      await expect(health.json()).resolves.toMatchObject({ ok: true });
      await expect(agent.json()).resolves.toMatchObject({
        ok: true,
        data: { state: "idle", entries: [] },
      });
      expect(started.readAppLanguage()).toBe("ZH");
    } finally {
      await bootstrap.stop();
    }

    expect(bootstrap.isStopped()).toBe(true);
  });
});
