import http from "node:http";
import { create_workspace_runtime_fixture } from "../../test/agent-workspace-fixture";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GuiBackendBootstrap } from "./gui-backend-bootstrap";
import { AppPathService } from "../app/app-path-service";
import { LLMClient } from "../llm/llm-client";
import { PiModelCatalog } from "../llm/pi-model-catalog";

describe("GuiBackendBootstrap 集成", () => {
  let check_catalog: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    check_catalog = vi.spyOn(PiModelCatalog.prototype, "check").mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("关闭 Gateway 时取消流式上传并清理半成品", async ({ onTestFinished }) => {
    const app_root = fs.mkdtempSync(path.join(os.tmpdir(), "lg-file-upload-"));
    fs.writeFileSync(path.join(app_root, "version.txt"), "1.2.3", "utf8");
    onTestFinished(() => fs.rmSync(app_root, { recursive: true, force: true }));
    const bootstrap = new GuiBackendBootstrap({
      appRoot: app_root,
      builtinRoot: path.resolve("builtin"),
      logTargets: { console: false, window: false },
      imageHost: async () => {
        throw new Error("Upload must not decode images");
      },
      systemProxyResolver: { resolveProxy: async () => "DIRECT" },
      workspaceRuntimeDirectory: create_workspace_runtime_fixture(app_root),
      openDirectory: async () => undefined,
      pickSavePath: async () => null,
      workerExecution: { kind: "in_process" },
    });
    try {
      const { apiBaseUrl } = await bootstrap.start();
      const source = path.join(app_root, "source.txt");
      fs.writeFileSync(source, "source");
      const created = await fetch(`${apiBaseUrl}/api/session/project/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: path.join(app_root, "test.lg"),
          source_paths: [source],
          project_settings: {
            source_language: "EN",
            target_language: "ZH",
            skip_duplicate_source_text_enable: true,
            mtool_optimizer_enable: false,
          },
        }),
      });
      expect(await created.json()).toMatchObject({ ok: true });
      const paths = new AppPathService({ appRoot: app_root, builtinRoot: path.resolve("builtin") });
      const uploads = path.join(paths.get_agent_workspace_root_dir(), "uploads");
      const pending = new Promise<void>((resolve) => {
        const request = http.request(
          `${apiBaseUrl}/api/agent/uploads?name=unfinished.bin`,
          { method: "POST", headers: { "Content-Type": "application/octet-stream" } },
          (response) => {
            response.resume();
            response.on("end", resolve);
          },
        );
        request.on("error", () => resolve());
        request.write(Buffer.from([0, 255, 1]));
        onTestFinished(() => {
          request.destroy();
        });
      });
      await vi.waitFor(() =>
        expect(
          fs.existsSync(uploads) && fs.readdirSync(uploads).some((name) => name.endsWith(".part")),
        ).toBe(true),
      );
      await bootstrap.stop();
      await pending;
      expect(fs.existsSync(uploads)).toBe(false);
      expect(bootstrap.isStopped()).toBe(true);
    } finally {
      await bootstrap.stop();
    }
  });
  it("关闭真实 Gateway 时取消在途接口测试并完成请求排空", async ({ onTestFinished }) => {
    const app_root = fs.mkdtempSync(path.join(os.tmpdir(), "lg-gateway-model-test-"));
    onTestFinished(() => fs.rmSync(app_root, { recursive: true, force: true }));
    fs.writeFileSync(path.join(app_root, "version.txt"), "1.2.3", "utf8");
    let started_request!: () => void;
    const ready = new Promise<void>((resolve) => {
      started_request = resolve;
    });
    const cancelled = vi.fn();
    const request = vi
      .spyOn(LLMClient.prototype, "request")
      .mockImplementation(async (_input, signal) => {
        started_request();
        return await new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              cancelled();
              reject(signal.reason);
            },
            { once: true },
          );
        });
      });
    onTestFinished(() => request.mockRestore());
    const bootstrap = new GuiBackendBootstrap({
      imageHost: async () => {
        throw new Error("Unexpected image request.");
      },
      appRoot: app_root,
      builtinRoot: path.resolve("builtin"),
      logTargets: { console: false, window: false },
      systemProxyResolver: { resolveProxy: async () => "DIRECT" },
      workspaceRuntimeDirectory: create_workspace_runtime_fixture(app_root),
      openDirectory: async () => undefined,
      pickSavePath: async () => null,
      workerExecution: { kind: "in_process" },
    });
    try {
      const started = await bootstrap.start();
      const response = await fetch(`${started.apiBaseUrl}/api/models/snapshot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const snapshot = (await response.json()) as {
        data: { snapshot: { models: Array<{ id: string }> } };
      };
      const model_id = snapshot.data.snapshot.models[0]!.id;
      const update = await fetch(`${started.apiBaseUrl}/api/models/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model_id, patch: { api_key: "test-key" } }),
      });
      expect(update.ok).toBe(true);
      const pending = Promise.allSettled([
        fetch(`${started.apiBaseUrl}/api/models/test`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model_id }),
        }),
      ]);
      await ready;
      await bootstrap.stop();
      await pending;
      expect(cancelled).toHaveBeenCalledOnce();
      expect(bootstrap.isStopped()).toBe(true);
    } finally {
      await bootstrap.stop();
    }
  });

  it("启动真实 Agent 与 Gateway，公开 API 保存工作区文件并打开目录", async ({ onTestFinished }) => {
    const app_root = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-gui-backend-"));
    onTestFinished(() => fs.rmSync(app_root, { recursive: true, force: true }));
    fs.writeFileSync(path.join(app_root, "version.txt"), "1.2.3", "utf8");
    const destination = path.join(app_root, "saved.md");
    const pick_save_path = vi.fn(async () => destination);
    const open_directory = vi.fn(async () => undefined);
    const bootstrap = new GuiBackendBootstrap({
      imageHost: async () => {
        throw new Error("Unexpected image request.");
      },
      appRoot: app_root,
      builtinRoot: path.resolve(process.cwd(), "builtin"),
      logTargets: { console: false, window: false },
      systemProxyResolver: { resolveProxy: async () => "DIRECT" },
      workspaceRuntimeDirectory: create_workspace_runtime_fixture(app_root),
      openDirectory: open_directory,
      pickSavePath: pick_save_path,
      workerExecution: { kind: "in_process" },
    });

    try {
      const started = await bootstrap.start();
      expect(check_catalog).toHaveBeenCalledOnce();
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
