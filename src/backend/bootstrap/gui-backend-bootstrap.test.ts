import { Model } from "../../domain/model";
import http from "node:http";
import { create_workspace_runtime_fixture } from "../../test/agent-workspace-fixture";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BackendResources } from "./backend-resources";
import { BackendServices } from "./backend-services";
import { AgentService } from "../agent/agent-service";
import { WebSearchService } from "../agent/web-search-service";
import { ApiGatewayServer } from "../api/api-gateway-server";

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

  it("技能管理在无工程时可用，空白对话立即采用开关和排序", async () => {
    using temporary = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-skills-gateway-"));
    const app_root = temporary.path;
    const options = create_options(app_root);
    const paths = new AppPathService(options);
    for (const name of ["first", "second"]) {
      const directory = path.join(paths.get_agent_user_skill_dir(), name);
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(
        path.join(directory, "SKILL.md"),
        `---\nname: ${name}\ndescription: Fixture skill\n---\nBody`,
      );
    }
    const bootstrap = new GuiBackendBootstrap(options);
    try {
      const { apiBaseUrl } = await bootstrap.start();
      /** 通过真实 Gateway 写配置，确保路由绑定和持久化共同生效。 */
      const post = async (route: string, body: Record<string, unknown> = {}) => {
        const response = await fetch(`${apiBaseUrl}${route}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        expect(response.ok).toBe(true);
        return response.json();
      };
      /** 从会话公开快照观察生效时机。 */
      const names = async (): Promise<string[]> => {
        const response = await fetch(`${apiBaseUrl}/api/agent/snapshot`);
        const payload = (await response.json()) as { data: { skills: { name: string }[] } };
        return payload.data.skills.map((skill) => skill.name);
      };
      expect(await names()).toEqual(["first", "second"]);
      await post("/api/skills/reorder", { names: ["second", "first"] });
      expect(await names()).toEqual(["second", "first"]);
      await post("/api/skills/enabled", { source: "user", name: "second", enabled: false });
      expect(await names()).toEqual(["first"]);
      await expect(post("/api/skills/snapshot")).resolves.toMatchObject({
        data: {
          skills: [
            { name: "second", enabled: false },
            { name: "first", enabled: true },
          ],
        },
      });
      await post("/api/agent/reset");
      expect(await names()).toEqual(["first"]);
      await post("/api/skills/enabled", { source: "user", name: "second", enabled: true });
      expect(await names()).toEqual(["second", "first"]);
      // 文件 API 与真实磁盘贯通，普通参考文件不改变技能候选。
      const skill = { source: "user", name: "first" };
      await expect(post("/api/skills/tree", skill)).resolves.toMatchObject({
        data: { entries: [{ path: "SKILL.md", kind: "file" }] },
      });
      await post("/api/skills/file/change", {
        ...skill,
        operation: "create_file",
        path: "reference.md",
      });
      const read = await post("/api/skills/file/read", { ...skill, path: "reference.md" });
      await post("/api/skills/file/save", {
        ...skill,
        path: "reference.md",
        revision: read.data.revision,
        text: "Reference\n",
      });
      expect(
        fs.readFileSync(
          path.join(paths.get_agent_user_skill_dir(), "first", "reference.md"),
          "utf8",
        ),
      ).toBe("Reference\n");
      expect(await names()).toEqual(["second", "first"]);
      const main = await post("/api/skills/file/read", { ...skill, path: "SKILL.md" });
      await post("/api/skills/file/save", {
        ...skill,
        path: "SKILL.md",
        revision: main.data.revision,
        document: { ...main.data.document, name: "renamed", description: "Updated fixture" },
      });
      expect(await names()).toEqual(["second", "renamed"]);
      const personality = await post("/api/agent/personality/read");
      const customized = await post("/api/agent/personality/save", {
        revision: personality.data.revision,
        body: "Custom integration role",
      });
      expect(customized.data.body).toBe("Custom integration role");
      const reset = await post("/api/agent/personality/save", {
        revision: customized.data.revision,
        body: null,
      });
      expect(reset.data.body).toBe("Test personality.");
      await post("/api/skills/delete", { source: "user", name: "renamed" });
      expect(await names()).toEqual(["second"]);
    } finally {
      await bootstrap.stop();
    }
  });

  it("关闭 Gateway 时取消流式上传并清理半成品", async ({ onTestFinished }) => {
    const app_root = fs.mkdtempSync(path.join(os.tmpdir(), "lg-file-upload-"));
    fs.writeFileSync(path.join(app_root, "version.txt"), "1.2.3", "utf8");
    onTestFinished(() => fs.rmSync(app_root, { recursive: true, force: true }));
    const bootstrap = new GuiBackendBootstrap(create_options(app_root));
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
      const paths = new AppPathService({
        appRoot: app_root,
        builtinRoot: path.join(app_root, "builtin"),
      });
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
    const bootstrap = new GuiBackendBootstrap(create_options(app_root));
    try {
      const started = await bootstrap.start();
      const model_id = "shutdown-fixture";
      started.backendServices.app.settings.save_setting({
        models: [
          Model.from_json(
            {
              id: model_id,
              api_format: "OpenAI",
              api_url: "https://example.test/v1",
              api_key: "test-key",
              model_id: "test-model",
            },
            model_id,
          ).to_json(),
        ],
      });
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
      ...create_options(app_root),
      openDirectory: open_directory,
      pickSavePath: pick_save_path,
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
      const paths = new AppPathService({
        appRoot: app_root,
        builtinRoot: path.join(app_root, "builtin"),
      });
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

  it("资源加载失败回滚网络入口，修复资源后可重新启动", async () => {
    using directory = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-bootstrap-failure-"));
    const options = create_options(directory.path);
    const paths = new AppPathService(options);
    fs.writeFileSync(paths.get_agent_system_prompt_path(), "invalid template");
    const original_fetch = globalThis.fetch;
    const bootstrap = new GuiBackendBootstrap(options);
    try {
      await expect(bootstrap.start()).rejects.toMatchObject({ code: "file.invalid_structure" });
      expect(bootstrap.isStopped()).toBe(true);
      expect(globalThis.fetch).toBe(original_fetch);
      create_options(directory.path);
      const started = await bootstrap.start();
      await expect((await fetch(started.apiBaseUrl + "/api/health")).json()).resolves.toMatchObject(
        { ok: true },
      );
    } finally {
      await bootstrap.stop();
    }
    expect(globalThis.fetch).toBe(original_fetch);
  });

  it("启动期间并发停止等待资源就绪并关闭完整生命周期", async () => {
    using directory = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-bootstrap-stop-"));
    const original_fetch = globalThis.fetch;
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const start_resources = BackendResources.start;
    vi.spyOn(BackendResources, "start").mockImplementationOnce(async (options) => {
      const resources = await start_resources(options);
      entered.resolve();
      await release.promise;
      return resources;
    });
    const bootstrap = new GuiBackendBootstrap(create_options(directory.path));
    const starting = bootstrap.start();
    const rejected = expect(starting).rejects.toMatchObject({ code: "runtime.disposed" });
    try {
      await entered.promise;
      const stopping = Promise.all([bootstrap.stop(), bootstrap.stop()]);
      await expect(bootstrap.start()).rejects.toMatchObject({ code: "runtime.internal_invariant" });
      expect(bootstrap.isStopped()).toBe(false);
      release.resolve();
      await rejected;
      await stopping;
      expect(bootstrap.isStopped()).toBe(true);
      expect(globalThis.fetch).toBe(original_fetch);
    } finally {
      release.resolve();
      await bootstrap.stop();
    }
  });

  it("多个关闭阶段失败仍释放监听器和网络入口，并汇总全部异常", async () => {
    using directory = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-bootstrap-cleanup-"));
    const original_fetch = globalThis.fetch;
    const bootstrap = new GuiBackendBootstrap(create_options(directory.path));
    const started = await bootstrap.start();
    const failures = Array.from({ length: 5 }, (_, index) => new Error("cleanup " + index));
    const stop_gateway = ApiGatewayServer.prototype.stop;
    vi.spyOn(ApiGatewayServer.prototype, "stop").mockImplementationOnce(async function (
      this: ApiGatewayServer,
    ) {
      await stop_gateway.call(this);
      throw failures[0];
    });
    for (const [index, prototype] of [
      AgentService.prototype,
      WebSearchService.prototype,
      BackendServices.prototype,
      BackendResources.prototype,
    ].entries()) {
      fail_after_dispose(prototype, failures[index + 1]!);
    }
    try {
      await expect(bootstrap.stop()).rejects.toMatchObject({ errors: failures });
      expect(bootstrap.isStopped()).toBe(true);
      expect(globalThis.fetch).toBe(original_fetch);
      await expect(fetch(started.apiBaseUrl + "/api/health")).rejects.toThrow();
      await expect(bootstrap.stop()).resolves.toBeUndefined();
    } finally {
      await bootstrap.stop();
    }
  });
});

/** 用测试自有资源启动真实服务，避免动态内置技能影响生命周期验证。 */
function create_options(app_root: string) {
  const builtin_root = path.join(app_root, "builtin");
  const paths = new AppPathService({ appRoot: app_root, builtinRoot: builtin_root });
  fs.mkdirSync(builtin_root, { recursive: true });
  fs.writeFileSync(path.join(app_root, "version.txt"), "1.2.3");
  fs.writeFileSync(
    paths.get_agent_system_prompt_path(),
    "Test system prompt.\n{{agent_personality}}",
  );
  fs.writeFileSync(paths.get_agent_session_seed_path(), "[]");
  fs.mkdirSync(paths.get_model_preset_dir(), { recursive: true });
  fs.writeFileSync(path.join(paths.get_model_preset_dir(), "preset_model_builtin.json"), "[]");
  for (const type of Model.custom_types()) {
    fs.writeFileSync(
      path.join(paths.get_model_preset_dir(), Model.resolve_template_filename(type)),
      "{}",
    );
  }
  fs.writeFileSync(path.join(builtin_root, "personality.md"), "Test personality.");
  return {
    appRoot: app_root,
    builtinRoot: builtin_root,
    logTargets: { console: false, window: false },
    imageHost: async (): Promise<never> => {
      throw new Error("Unexpected image request");
    },
    systemProxyResolver: { resolveProxy: async () => "DIRECT" },
    workspaceRuntimeDirectory: create_workspace_runtime_fixture(app_root),
    openDirectory: async () => undefined,
    pickSavePath: async () => null,
    workerExecution: { kind: "in_process" as const },
  };
}

/** 真实清理完成后注入故障，避免故障测试本身遗留监听器、线程或网络入口。 */
function fail_after_dispose(prototype: { dispose(): Promise<void> }, failure: Error): void {
  const dispose = prototype.dispose;
  vi.spyOn(prototype, "dispose").mockImplementationOnce(async function (this: {
    dispose(): Promise<void>;
  }) {
    await dispose.call(this);
    throw failure;
  });
}
