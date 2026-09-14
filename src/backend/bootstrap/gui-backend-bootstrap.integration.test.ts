import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { GuiBackendBootstrap } from "./gui-backend-bootstrap";
import { AppPathService } from "../app/app-path-service";

describe("GuiBackendBootstrap 集成", () => {
  it("启动真实 Agent 与 Gateway，公开 API 保存工作区文件并打开目录", async ({ onTestFinished }) => {
    const app_root = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-gui-backend-"));
    onTestFinished(() => fs.rmSync(app_root, { recursive: true, force: true }));
    fs.writeFileSync(path.join(app_root, "version.txt"), "1.2.3", "utf8");
    const destination = path.join(app_root, "saved.md");
    const pick_save_path = vi.fn(async () => destination);
    const open_directory = vi.fn(async () => undefined);
    const bootstrap = new GuiBackendBootstrap({
      appRoot: app_root,
      builtinRoot: path.resolve(process.cwd(), "builtin"),
      logTargets: { console: false, window: false },
      systemProxyResolver: { resolveProxy: async () => "DIRECT" },
      agentWorkspaceRun: async (request) => ({ result: null, todos: [...request.todos] }),
      openDirectory: open_directory,
      pickSavePath: pick_save_path,
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
      const paths = new AppPathService({ appRoot: app_root, builtinRoot: path.resolve("builtin") });
      const directory = path.join(paths.get_agent_workspace_root_dir(), "work", "报告");
      fs.mkdirSync(directory, { recursive: true });
      const file = path.join(directory, "结果 # 1.md");
      fs.writeFileSync(file, "报告");
      const open = await fetch(`${started.apiBaseUrl}/api/agent/workspace/activate-path`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "work/报告/结果%20%23%201.md" }),
      });
      await expect(open.json()).resolves.toEqual({ ok: true, data: { status: "saved" } });
      expect(fs.readFileSync(destination)).toEqual(fs.readFileSync(file));
      expect(pick_save_path).toHaveBeenCalledWith("结果 # 1.md");
      const folder = await fetch(started.apiBaseUrl + "/api/agent/workspace/activate-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "work/报告/" }),
      });
      await expect(folder.json()).resolves.toEqual({ ok: true, data: { status: "opened" } });
      expect(open_directory).toHaveBeenCalledWith(directory);
      const missing = await fetch(`${started.apiBaseUrl}/api/agent/workspace/activate-path`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "work/missing.md" }),
      });
      expect(missing.status).toBe(404);
      await expect(missing.json()).resolves.toMatchObject({
        ok: false,
        error: { code: "file.not_found" },
      });
    } finally {
      await bootstrap.stop();
    }

    expect(bootstrap.isStopped()).toBe(true);
  });
});
