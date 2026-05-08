import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectDatabase } from "../database/database-operations";
import { type FileLogWriter, LogManager } from "../log/log-manager";
import { allocate_core_api_port } from "../lifecycle/lifecycle-port-allocator";
import { JsonTool } from "../../utils/json-tool";
import { ApiGatewayServer } from "./api-gateway-server";

describe("ApiGatewayServer", () => {
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
      publicPort: await allocate_core_api_port(),
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
      publicPort: await allocate_core_api_port(),
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
      publicPort: await allocate_core_api_port(),
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
      publicPort: await allocate_core_api_port(),
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

  it("通过公开 /api/logs/append 接收 Python 日志提交", async () => {
    const app_root = create_app_root();
    const py_server = await start_fake_py_server();
    const database = new ProjectDatabase();
    const log_manager = create_log_manager(app_root);
    const gateway = new ApiGatewayServer({
      appRoot: app_root,
      database,
      logManager: log_manager,
      publicPort: await allocate_core_api_port(),
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
      publicPort: await allocate_core_api_port(),
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
      publicPort: await allocate_core_api_port(),
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

  function create_log_manager(app_root: string): LogManager {
    const log_manager = new LogManager({
      consoleWriter: () => undefined,
      fileWriter: create_memory_file_writer(),
      logDir: path.join(app_root, "log"),
    });
    cleanup_callbacks.push(() => log_manager.shutdown());
    return log_manager;
  }

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

  async function start_fake_py_server(): Promise<{
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
});
