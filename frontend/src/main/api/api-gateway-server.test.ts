import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectDatabase } from "../database/database-operations";
import { type FileLogWriter, LogManager } from "../log/log-manager";
import { JsonTool } from "../../utils/json-tool";
import { ApiGatewayServer } from "./api-gateway-server";

describe("ApiGatewayServer", () => {
  // Gateway 测试会启动真实本机 HTTP server，清理顺序必须由用例统一登记。
  const cleanup_callbacks: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanup_callbacks.length > 0) {
      const cleanup = cleanup_callbacks.pop();
      await cleanup?.();
    }
  });

  it("由 TS Gateway 响应公开健康检查", async () => {
    const app_root = create_app_root();
    const py_server = await start_fake_py_server();
    const database = new ProjectDatabase();
    const log_manager = create_log_manager(app_root);
    const gateway = new ApiGatewayServer({
      appRoot: app_root,
      database,
      logManager: log_manager,
      publicPort: await allocate_gateway_test_port(),
      pyCoreBaseUrl: py_server.baseUrl,
      pyCoreToken: "py-token",
    });
    cleanup_callbacks.push(() => gateway.stop());
    cleanup_callbacks.push(() => database.close());
    cleanup_callbacks.push(py_server.close);

    const started = await gateway.start();
    const response = await fetch(`${started.baseUrl}/api/health`);
    const body = (await response.json()) as {
      ok?: boolean;
      data?: { service?: string; version?: string; instanceToken?: string };
    };

    expect(body.ok).toBe(true);
    expect(body.data?.service).toBe("linguagacha-core");
    expect(body.data?.version).toBe("9.8.7");
    expect(body.data?.instanceToken).toBe(started.instanceToken);
  });

  it("把未迁移 JSON 路由透明代理到内部 Python Core", async () => {
    const app_root = create_app_root();
    const py_server = await start_fake_py_server();
    const database = new ProjectDatabase();
    const log_manager = create_log_manager(app_root);
    const gateway = new ApiGatewayServer({
      appRoot: app_root,
      database,
      logManager: log_manager,
      publicPort: await allocate_gateway_test_port(),
      pyCoreBaseUrl: py_server.baseUrl,
      pyCoreToken: "py-token",
    });
    cleanup_callbacks.push(() => gateway.stop());
    cleanup_callbacks.push(() => database.close());
    cleanup_callbacks.push(py_server.close);

    const started = await gateway.start();
    const response = await fetch(`${started.baseUrl}/api/proxy-target`, {
      body: JsonTool.stringifyStrict({ value: 7 }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const body = (await response.json()) as {
      ok?: boolean;
      data?: { method?: string; raw?: string };
    };

    expect(body.ok).toBe(true);
    expect(body.data?.method).toBe("POST");
    expect(body.data?.raw).toBe('{"value":7}');
  });

  it("P2 项目同步 mutation 由 TS Gateway 直接处理且不转发到 Python Core", async () => {
    const app_root = create_app_root();
    const py_server = await start_fake_py_server();
    const database = new ProjectDatabase();
    const log_manager = create_log_manager(app_root);
    const gateway = new ApiGatewayServer({
      appRoot: app_root,
      database,
      logManager: log_manager,
      publicPort: await allocate_gateway_test_port(),
      pyCoreBaseUrl: py_server.baseUrl,
      pyCoreToken: "py-token",
    });
    cleanup_callbacks.push(() => gateway.stop());
    cleanup_callbacks.push(() => database.close());
    cleanup_callbacks.push(py_server.close);
    const lg_path = path.join(app_root, "direct-write.lg");
    database.execute({
      name: "createProject",
      args: { projectPath: lg_path, name: "direct-write" },
    });

    const started = await gateway.start();
    const response = await fetch(`${started.baseUrl}/api/project/settings-alignment/apply`, {
      body: JsonTool.stringifyStrict({
        mode: "settings_only",
        path: lg_path,
        project_settings: { source_language: "JA", target_language: "ZH" },
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const body = (await response.json()) as {
      ok?: boolean;
      data?: { accepted?: boolean };
    };

    expect(body.ok).toBe(true);
    expect(body.data?.accepted).toBe(true);
    expect(py_server.requests).toEqual([]);
  });

  it("项目轻生命周期路由由 TS Gateway 直接处理", async () => {
    const app_root = create_app_root();
    const database = new ProjectDatabase();
    const lg_path = path.join(app_root, "project-lifecycle.lg");
    const source_dir = path.join(app_root, "source");
    fs.mkdirSync(source_dir, { recursive: true });
    fs.writeFileSync(path.join(source_dir, "script.txt"), "原文", "utf-8");
    fs.writeFileSync(path.join(source_dir, "ignored.bin"), "bin", "utf-8");
    database.execute({
      name: "createProject",
      args: { projectPath: lg_path, name: "project-lifecycle" },
    });
    const py_server = await start_fake_py_server(lg_path);
    const log_manager = create_log_manager(app_root);
    const gateway = new ApiGatewayServer({
      appRoot: app_root,
      database,
      logManager: log_manager,
      publicPort: await allocate_gateway_test_port(),
      pyCoreBaseUrl: py_server.baseUrl,
      pyCoreToken: "py-token",
    });
    cleanup_callbacks.push(() => gateway.stop());
    cleanup_callbacks.push(() => database.close());
    cleanup_callbacks.push(py_server.close);

    const started = await gateway.start();
    await fetch(`${started.baseUrl}/api/project/load`, {
      body: JsonTool.stringifyStrict({ path: lg_path }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const snapshot_response = await fetch(`${started.baseUrl}/api/project/snapshot`, {
      body: "{}",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const preview_response = await fetch(`${started.baseUrl}/api/project/preview`, {
      body: JsonTool.stringifyStrict({ path: lg_path }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const source_files_response = await fetch(`${started.baseUrl}/api/project/source-files`, {
      body: JsonTool.stringifyStrict({ source_paths: [source_dir] }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const unload_response = await fetch(`${started.baseUrl}/api/project/unload`, {
      body: "{}",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const snapshot_body = (await snapshot_response.json()) as {
      data?: { project?: { path?: string; loaded?: boolean; busy?: boolean } };
    };
    const preview_body = (await preview_response.json()) as {
      data?: { preview?: { path?: string; name?: string } };
    };
    const source_files_body = (await source_files_response.json()) as {
      data?: { source_files?: string[] };
    };
    const unload_body = (await unload_response.json()) as {
      data?: { project?: { path?: string; loaded?: boolean } };
    };

    expect(snapshot_body.data?.project).toEqual({ path: lg_path, loaded: true });
    expect(preview_body.data?.preview?.path).toBe(lg_path);
    expect(preview_body.data?.preview?.name).toBe("project-lifecycle");
    expect(source_files_body.data?.source_files).toEqual([path.join(source_dir, "script.txt")]);
    expect(unload_body.data?.project).toEqual({ path: "", loaded: false });
    const py_request_paths = py_server.requests.map((item) => item.path);
    expect(py_request_paths).toContain("/internal/runtime/sync");
    expect(py_request_paths).toContain("/api/project/load");
    expect(py_request_paths).not.toContain("/api/project/snapshot");
    expect(py_request_paths).not.toContain("/api/project/preview");
    expect(py_request_paths).not.toContain("/api/project/source-files");
    expect(py_request_paths).not.toContain("/api/project/unload");
    expect(py_server.requests.findLast((item) => item.path === "/internal/runtime/sync")?.raw).toBe(
      JsonTool.stringifyStrict({ type: "project_unload", payload: {} }),
    );
  });

  it("未迁移项目路由继续代理到 Python Core", async () => {
    const app_root = create_app_root();
    const py_server = await start_fake_py_server();
    const database = new ProjectDatabase();
    const log_manager = create_log_manager(app_root);
    const gateway = new ApiGatewayServer({
      appRoot: app_root,
      database,
      logManager: log_manager,
      publicPort: await allocate_gateway_test_port(),
      pyCoreBaseUrl: py_server.baseUrl,
      pyCoreToken: "py-token",
    });
    cleanup_callbacks.push(() => gateway.stop());
    cleanup_callbacks.push(() => database.close());
    cleanup_callbacks.push(py_server.close);

    const started = await gateway.start();
    const response = await fetch(`${started.baseUrl}/api/project/load`, {
      body: JsonTool.stringifyStrict({ path: "demo.lg" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const body = (await response.json()) as { ok?: boolean };

    expect(body.ok).toBe(true);
    expect(py_server.requests.map((item) => item.path)).toContain("/api/project/load");
  });

  it("项目 preview 缺失文件时映射为 not_found", async () => {
    const app_root = create_app_root();
    const py_server = await start_fake_py_server();
    const database = new ProjectDatabase();
    const log_manager = create_log_manager(app_root);
    const gateway = new ApiGatewayServer({
      appRoot: app_root,
      database,
      logManager: log_manager,
      publicPort: await allocate_gateway_test_port(),
      pyCoreBaseUrl: py_server.baseUrl,
      pyCoreToken: "py-token",
    });
    cleanup_callbacks.push(() => gateway.stop());
    cleanup_callbacks.push(() => database.close());
    cleanup_callbacks.push(py_server.close);

    const started = await gateway.start();
    const response = await fetch(`${started.baseUrl}/api/project/preview`, {
      body: JsonTool.stringifyStrict({ path: path.join(app_root, "missing.lg") }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const body = (await response.json()) as {
      ok?: boolean;
      error?: { code?: string };
    };

    expect(response.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("not_found");
    expect(py_server.requests).toEqual([]);
  });

  it("校对同步 mutation 由 TS Gateway 直接写库且只调用内部 runtime bridge", async () => {
    const app_root = create_app_root();
    const database = new ProjectDatabase();
    const lg_path = path.join(app_root, "proofreading-direct-write.lg");
    const py_server = await start_fake_py_server(lg_path);
    const log_manager = create_log_manager(app_root);
    const gateway = new ApiGatewayServer({
      appRoot: app_root,
      database,
      logManager: log_manager,
      publicPort: await allocate_gateway_test_port(),
      pyCoreBaseUrl: py_server.baseUrl,
      pyCoreToken: "py-token",
    });
    cleanup_callbacks.push(() => gateway.stop());
    cleanup_callbacks.push(() => database.close());
    cleanup_callbacks.push(py_server.close);
    database.execute({
      name: "createProject",
      args: { projectPath: lg_path, name: "proofreading-direct-write" },
    });
    database.execute({
      name: "setItems",
      args: {
        projectPath: lg_path,
        items: [{ id: 1, src: "原文", dst: "", status: "NONE" }],
      },
    });

    const started = await gateway.start();
    await fetch(`${started.baseUrl}/api/project/load`, {
      body: JsonTool.stringifyStrict({ path: lg_path }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const response = await fetch(`${started.baseUrl}/api/project/proofreading/save-item`, {
      body: JsonTool.stringifyStrict({
        items: [{ id: 1, dst: "译文", status: "PROCESSED" }],
        translation_extras: { line: 1 },
        expected_section_revisions: { items: 0, proofreading: 0 },
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const body = (await response.json()) as {
      ok?: boolean;
      data?: { accepted?: boolean; sectionRevisions?: Record<string, number> };
    };

    expect(body.ok).toBe(true);
    expect(body.data?.accepted).toBe(true);
    expect(body.data?.sectionRevisions).toEqual({ items: 1, proofreading: 1 });
    expect(database.execute({ name: "getAllItems", args: { projectPath: lg_path } })).toEqual([
      { id: 1, src: "原文", dst: "译文", status: "PROCESSED" },
    ]);
    expect(py_server.requests.map((item) => item.path)).toContain("/api/project/load");
    expect(py_server.requests.map((item) => item.path)).toContain("/internal/runtime/sync");
    expect(py_server.requests.map((item) => item.path)).not.toContain(
      "/api/project/proofreading/save-item",
    );
  });

  it("由 TS LogManager 直接提供公开日志流", async () => {
    const app_root = create_app_root();
    const py_server = await start_fake_py_server();
    const database = new ProjectDatabase();
    const log_manager = create_log_manager(app_root);
    log_manager.info("启动完成", { source: "test" });
    const gateway = new ApiGatewayServer({
      appRoot: app_root,
      database,
      logManager: log_manager,
      publicPort: await allocate_gateway_test_port(),
      pyCoreBaseUrl: py_server.baseUrl,
      pyCoreToken: "py-token",
    });
    cleanup_callbacks.push(() => gateway.stop());
    cleanup_callbacks.push(() => log_manager.shutdown());
    cleanup_callbacks.push(() => database.close());
    cleanup_callbacks.push(py_server.close);

    const started = await gateway.start();
    const controller = new AbortController();
    const response = await fetch(`${started.baseUrl}/api/logs/stream`, {
      signal: controller.signal,
    });
    const reader = response.body?.getReader();
    if (reader === undefined) {
      throw new Error("日志流响应体为空。");
    }
    const chunk = await reader.read();
    controller.abort();

    const text = new TextDecoder().decode(chunk.value);
    expect(response.status).toBe(200);
    expect(text).toContain("event: log.appended");
    expect(text).toContain('"message":"启动完成"');
    expect(py_server.requests.map((item) => item.path)).not.toContain("/api/logs/stream");
  });

  it("由 TS Gateway 直接提供 bootstrap 流且不代理到 Python Core", async () => {
    const app_root = create_app_root();
    const database = new ProjectDatabase();
    const lg_path = path.join(app_root, "bootstrap-direct.lg");
    const py_server = await start_fake_py_server(lg_path);
    const log_manager = create_log_manager(app_root);
    const gateway = new ApiGatewayServer({
      appRoot: app_root,
      database,
      logManager: log_manager,
      publicPort: await allocate_gateway_test_port(),
      pyCoreBaseUrl: py_server.baseUrl,
      pyCoreToken: "py-token",
    });
    cleanup_callbacks.push(() => gateway.stop());
    cleanup_callbacks.push(() => database.close());
    cleanup_callbacks.push(py_server.close);
    database.execute({ name: "createProject", args: { projectPath: lg_path, name: "bootstrap" } });
    database.execute_transaction([
      {
        name: "setItems",
        args: {
          projectPath: lg_path,
          items: [{ id: 1, file_path: "a.txt", row: 1, src: "原文", status: "NONE" }],
        },
      },
      {
        name: "setRuleText",
        args: { projectPath: lg_path, ruleType: "translation_prompt", text: "\uD800" },
      },
      {
        name: "setMeta",
        args: { projectPath: lg_path, key: "quality_prompt_revision.translation", value: 1 },
      },
    ]);

    const started = await gateway.start();
    await fetch(`${started.baseUrl}/api/project/load`, {
      body: JsonTool.stringifyStrict({ path: lg_path }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const response = await fetch(`${started.baseUrl}/api/project/bootstrap/stream`);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(text).toContain("event: stage_started");
    expect(text).toContain('"stage":"project"');
    expect(text).toContain("event: completed");
    expect(text).toContain('"sectionRevisions"');
    expect(text).toContain("\\ud800");
    expect(py_server.requests.map((item) => item.path)).toContain("/api/project/load");
    expect(py_server.requests.map((item) => item.path)).toContain("/api/tasks/snapshot");
    expect(py_server.requests.map((item) => item.path)).not.toContain(
      "/api/project/bootstrap/stream",
    );
  });

  it("长期事件流继续代理到 Python Core", async () => {
    const app_root = create_app_root();
    const py_server = await start_fake_py_server();
    const database = new ProjectDatabase();
    const log_manager = create_log_manager(app_root);
    const gateway = new ApiGatewayServer({
      appRoot: app_root,
      database,
      logManager: log_manager,
      publicPort: await allocate_gateway_test_port(),
      pyCoreBaseUrl: py_server.baseUrl,
      pyCoreToken: "py-token",
    });
    cleanup_callbacks.push(() => gateway.stop());
    cleanup_callbacks.push(() => database.close());
    cleanup_callbacks.push(py_server.close);

    const started = await gateway.start();
    const response = await fetch(`${started.baseUrl}/api/events/stream`);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toContain("event: py.event");
    expect(py_server.requests.map((item) => item.path)).toContain("/api/events/stream");
  });

  it("取消长期事件流时会关闭上游 Python Core 连接", async () => {
    const app_root = create_app_root();
    const py_server = await start_abortable_event_py_server();
    const database = new ProjectDatabase();
    const log_manager = create_log_manager(app_root);
    const gateway = new ApiGatewayServer({
      appRoot: app_root,
      database,
      logManager: log_manager,
      publicPort: await allocate_gateway_test_port(),
      pyCoreBaseUrl: py_server.baseUrl,
      pyCoreToken: "py-token",
    });
    cleanup_callbacks.push(() => gateway.stop());
    cleanup_callbacks.push(() => database.close());
    cleanup_callbacks.push(py_server.close);

    const started = await gateway.start();
    const controller = new AbortController();
    const response = await fetch(`${started.baseUrl}/api/events/stream`, {
      signal: controller.signal,
    });
    const reader = response.body?.getReader();
    if (reader === undefined) {
      throw new Error("事件流响应体为空。");
    }
    const chunk = await reader.read();

    controller.abort();

    expect(new TextDecoder().decode(chunk.value)).toContain("event: py.event");
    await expect(with_timeout(py_server.eventClosed, "上游事件流未关闭。")).resolves.toBeUndefined();
  });

  it("通过公开 /api/logs/append 接收 Python 日志提交", async () => {
    const app_root = create_app_root();
    const py_server = await start_fake_py_server();
    const database = new ProjectDatabase();
    const log_manager = create_log_manager(app_root);
    const gateway = new ApiGatewayServer({
      appRoot: app_root,
      database,
      logManager: log_manager,
      publicPort: await allocate_gateway_test_port(),
      pyCoreBaseUrl: py_server.baseUrl,
      pyCoreToken: "py-token",
    });
    cleanup_callbacks.push(() => gateway.stop());
    cleanup_callbacks.push(() => database.close());
    cleanup_callbacks.push(py_server.close);

    const started = await gateway.start();
    const rejected_response = await fetch(`${started.baseUrl}/api/logs/append`, {
      body: JsonTool.stringifyStrict({ level: "info", message: "拒绝日志" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const accepted_response = await fetch(`${started.baseUrl}/api/logs/append`, {
      body: JsonTool.stringifyStrict({
        level: "warning",
        message: "公开日志",
        targets: { console: false, file: false, window: true },
      }),
      headers: {
        "Content-Type": "application/json",
        "X-LinguaGacha-Core-Token": "py-token",
      },
      method: "POST",
    });
    const body = (await accepted_response.json()) as { ok?: boolean };

    expect(rejected_response.status).toBe(401);
    expect(accepted_response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(log_manager.snapshot_events().map((event) => event.message)).toEqual(["公开日志"]);
    expect(py_server.requests.map((item) => item.path)).not.toContain("/api/logs/append");
  });

  it("公开日志提交会接收空消息且不阻断后续 Python 日志", async () => {
    const app_root = create_app_root();
    const py_server = await start_fake_py_server();
    const database = new ProjectDatabase();
    const log_manager = create_log_manager(app_root);
    const gateway = new ApiGatewayServer({
      appRoot: app_root,
      database,
      logManager: log_manager,
      publicPort: await allocate_gateway_test_port(),
      pyCoreBaseUrl: py_server.baseUrl,
      pyCoreToken: "py-token",
    });
    cleanup_callbacks.push(() => gateway.stop());
    cleanup_callbacks.push(() => database.close());
    cleanup_callbacks.push(py_server.close);

    const started = await gateway.start();
    const headers = {
      "Content-Type": "application/json",
      "X-LinguaGacha-Core-Token": "py-token",
    };
    const empty_response = await fetch(`${started.baseUrl}/api/logs/append`, {
      body: JsonTool.stringifyStrict({ level: "info", message: "" }),
      headers,
      method: "POST",
    });
    const accepted_response = await fetch(`${started.baseUrl}/api/logs/append`, {
      body: JsonTool.stringifyStrict({
        level: "info",
        message: "接口测试开始",
        targets: { console: false, file: false, window: true },
      }),
      headers,
      method: "POST",
    });
    const empty_body = (await empty_response.json()) as {
      ok?: boolean;
      data?: { accepted?: boolean };
    };
    const accepted_body = (await accepted_response.json()) as {
      ok?: boolean;
      data?: { accepted?: boolean };
    };

    expect(empty_response.status).toBe(200);
    expect(empty_body).toEqual({ ok: true, data: { accepted: true } });
    expect(accepted_response.status).toBe(200);
    expect(accepted_body).toEqual({ ok: true, data: { accepted: true } });
    expect(log_manager.snapshot_events().map((event) => event.message)).toEqual([
      "",
      "接口测试开始",
    ]);
  });

  it("代理 Python Core 失败时写入 TS Gateway 日志", async () => {
    const app_root = create_app_root();
    const py_server = await start_fake_py_server();
    const py_core_base_url = py_server.baseUrl;
    await py_server.close();
    const database = new ProjectDatabase();
    const log_manager = create_log_manager(app_root);
    const gateway = new ApiGatewayServer({
      appRoot: app_root,
      database,
      logManager: log_manager,
      publicPort: await allocate_gateway_test_port(),
      pyCoreBaseUrl: py_core_base_url,
      pyCoreToken: "py-token",
    });
    cleanup_callbacks.push(() => gateway.stop());
    cleanup_callbacks.push(() => database.close());

    const started = await gateway.start();
    const response = await fetch(`${started.baseUrl}/api/proxy-target`, { method: "POST" });
    const body = (await response.json()) as { ok?: boolean };

    expect(response.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(log_manager.snapshot_events().map((event) => event.message)).toContain(
      "TS Gateway 代理 Python Core 失败",
    );
  });

  it("公开端口监听失败时拒绝启动并保持 stop 幂等", async () => {
    const app_root = create_app_root();
    const py_server = await start_fake_py_server();
    const database = new ProjectDatabase();
    const log_manager = create_log_manager(app_root);
    const occupied_server = http.createServer();
    await new Promise<void>((resolve, reject) => {
      occupied_server.once("error", reject);
      occupied_server.listen(0, "127.0.0.1", () => {
        occupied_server.off("error", reject);
        resolve();
      });
    });
    cleanup_callbacks.push(
      () =>
        new Promise<void>((resolve, reject) => {
          occupied_server.close((error) => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          });
        }),
    );
    cleanup_callbacks.push(() => database.close());
    cleanup_callbacks.push(py_server.close);
    const address = occupied_server.address();
    if (typeof address !== "object" || address === null) {
      throw new Error("测试占用端口未取得地址。");
    }
    const gateway = new ApiGatewayServer({
      appRoot: app_root,
      database,
      logManager: log_manager,
      publicPort: address.port,
      pyCoreBaseUrl: py_server.baseUrl,
      pyCoreToken: "py-token",
    });

    await expect(gateway.start()).rejects.toThrow();
    await expect(gateway.stop()).resolves.toBeUndefined();
  });

  function create_app_root(): string {
    const app_root = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-gateway-test-"));
    fs.writeFileSync(path.join(app_root, "version.txt"), "9.8.7", "utf-8");
    cleanup_callbacks.push(() => fs.rmSync(app_root, { force: true, recursive: true }));
    return app_root;
  }

  /**
   * 测试使用 OS 分配的本机端口，避免随机高位端口在 Windows 上命中保留范围。
   */
  async function allocate_gateway_test_port(): Promise<number> {
    const server = http.createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
    if (typeof address !== "object" || address === null) {
      throw new Error("测试端口未取得地址。");
    }
    return address.port;
  }

  /**
   * 使用内存 writer 避免 Gateway 测试把日志落到真实用户目录。
   */
  function create_log_manager(app_root: string): LogManager {
    const log_manager = new LogManager({
      consoleWriter: () => undefined,
      fileWriter: create_memory_file_writer(),
      logDir: path.join(app_root, "log"),
    });
    cleanup_callbacks.push(() => log_manager.shutdown());
    return log_manager;
  }

  /**
   * fake writer 只验证 LogManager 路由行为，不关心文件系统刷新细节。
   */
  function create_memory_file_writer(): FileLogWriter {
    return {
      write: () => undefined,
      flush: () => undefined,
      flushSync: () => undefined,
      end: (callback?: () => void) => {
        callback?.();
      },
    };
  }

  /**
   * fake Python server 同时覆盖代理、runtime bridge 和任务快照三类边界。
   */
  async function start_fake_py_server(runtime_project_path?: string): Promise<{
    baseUrl: string;
    close: () => Promise<void>;
    requests: Array<{ method?: string; path?: string; raw: string }>;
  }> {
    const requests: Array<{ method?: string; path?: string; raw: string }> = [];
    const server = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });
      request.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf-8");
        requests.push({ method: request.method, path: request.url, raw });
        if (request.url === "/internal/runtime/project-state") {
          response.writeHead(200, {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/json; charset=utf-8",
          });
          response.end(
            JsonTool.stringifyStrict({
              ok: true,
              data: {
                loaded: runtime_project_path !== undefined,
                projectPath: runtime_project_path ?? "",
                busy: false,
              },
            }),
          );
          return;
        }
        if (request.url === "/internal/runtime/sync") {
          response.writeHead(200, {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/json; charset=utf-8",
          });
          response.end(JsonTool.stringifyStrict({ ok: true, data: { accepted: true } }));
          return;
        }
        if (request.url === "/api/tasks/snapshot") {
          response.writeHead(200, {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/json; charset=utf-8",
          });
          response.end(
            JsonTool.stringifyStrict({
              ok: true,
              data: {
                task: {
                  task_type: "translation",
                  status: "IDLE",
                  busy: false,
                },
              },
            }),
          );
          return;
        }
        if (request.url === "/api/project/load") {
          response.writeHead(200, {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/json; charset=utf-8",
          });
          response.end(
            JsonTool.stringifyStrict({
              ok: true,
              data: {
                project: {
                  path: runtime_project_path ?? "",
                  loaded: runtime_project_path !== undefined,
                },
              },
            }),
          );
          return;
        }
        if (request.url === "/api/events/stream") {
          response.writeHead(200, {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "text/event-stream; charset=utf-8",
          });
          response.end('event: py.event\ndata: {"ok":true}\n\n');
          return;
        }
        response.writeHead(200, {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json; charset=utf-8",
        });
        response.end(
          JsonTool.stringifyStrict({
            ok: true,
            data: {
              method: request.method,
              raw,
            },
          }),
        );
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (typeof address !== "object" || address === null) {
      throw new Error("测试服务器未取得端口。");
    }
    return {
      baseUrl: `http://127.0.0.1:${address.port.toString()}`,
      requests,
      close: () =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          });
        }),
    };
  }

  async function start_abortable_event_py_server(): Promise<{
    baseUrl: string;
    close: () => Promise<void>;
    eventClosed: Promise<void>;
  }> {
    let resolve_event_closed: (() => void) | null = null;
    const event_closed = new Promise<void>((resolve) => {
      resolve_event_closed = resolve;
    });
    const server = http.createServer((request, response) => {
      if (request.url !== "/api/events/stream") {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "text/event-stream; charset=utf-8",
      });
      response.write('event: py.event\ndata: {"ok":true}\n\n');
      request.on("close", () => {
        resolve_event_closed?.();
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (typeof address !== "object" || address === null) {
      throw new Error("测试服务器未取得端口。");
    }
    return {
      baseUrl: `http://127.0.0.1:${address.port.toString()}`,
      eventClosed: event_closed,
      close: () =>
        new Promise<void>((resolve, reject) => {
          server.closeAllConnections();
          server.close((error) => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          });
        }),
    };
  }

  async function with_timeout<T>(promise: Promise<T>, message: string): Promise<T> {
    let timeout_id: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_resolve, reject) => {
          timeout_id = setTimeout(() => reject(new Error(message)), 1000);
        }),
      ]);
    } finally {
      if (timeout_id !== null) {
        clearTimeout(timeout_id);
      }
    }
  }
});
