import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { AppMetadataService } from "../app/app-metadata-service";
import { AppPathService } from "../app/app-path-service";
import { AppSettingService } from "../app/app-setting-service";
import { BackendServices } from "../bootstrap/backend-services";
import { ProjectDatabase } from "../database/database-operations";
import type { BackendWorkerExecution } from "../worker/worker-execution";
import { type FileLogWriter, LogManager } from "../log/log-manager";
import { ApiGatewayServer } from "./api-gateway-server";

const IN_PROCESS_WORKER_EXECUTION: BackendWorkerExecution = { kind: "in_process" };

describe("ApiGatewayServer", () => {
  const cleanup_callbacks: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanup_callbacks.length > 0) {
      await cleanup_callbacks.pop()?.();
    }
  });

  it("响应公开健康检查", async () => {
    const gateway = create_gateway();

    const started = await gateway.start();
    const response = await fetch(`${started.baseUrl}/api/health`);

    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: {
        service: "linguagacha-backend",
        status: "ok",
        version: "9.8.7",
      },
    });
  });

  it("预检请求只暴露公开 CORS 头", async () => {
    const gateway = create_gateway();

    const started = await gateway.start();
    const response = await fetch(`${started.baseUrl}/api/session/project/manifest`, {
      headers: { "Access-Control-Request-Headers": "X-Private-Header" },
      method: "OPTIONS",
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET,POST,OPTIONS");
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type");
  });

  it("未知路由返回稳定 request.route_not_found", async () => {
    const gateway = create_gateway();

    const started = await gateway.start();
    const response = await post_json(started.baseUrl, "/api/not-registered", {});
    const body = (await response.json()) as { ok?: boolean; error?: { code?: string } };

    expect(response.status).toBe(404);
    expect(body).toMatchObject({
      ok: false,
      error: { code: "request.route_not_found" },
    });
  });

  it("由 LogManager 提供轻量日志流和按需详情", async () => {
    const app_root = create_app_root();
    const database = new ProjectDatabase();
    const log_manager = create_log_manager(app_root);
    const full_message = `启动完成\n${"完整详情".repeat(400)}\n详情尾部`;
    log_manager.info(full_message, { source: "test" });
    const gateway = create_gateway_fixture(app_root, database, log_manager).gateway;

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
    expect(text).toContain('"message_preview"');
    expect(text).not.toContain('"message":');
    expect(text).not.toContain("详情尾部");

    const detail_response = await post_json(started.baseUrl, "/api/logs/detail", { id: "log-1" });
    const detail_body = (await detail_response.json()) as {
      data?: { detail?: { content?: { kind?: string; text?: string }; source?: string } };
    };
    expect(detail_body.data?.detail).toMatchObject({
      content: { kind: "text", text: full_message },
      source: "test",
    });
  });

  it("接收 renderer 异常诊断并写入统一日志", async () => {
    const app_root = create_app_root();
    const database = new ProjectDatabase();
    const log_manager = create_log_manager(app_root);
    const gateway = create_gateway_fixture(app_root, database, log_manager).gateway;

    const started = await gateway.start();
    const response = await post_json(started.baseUrl, "/api/diagnostics/renderer-error", {
      source: "scheduler",
      error: {
        name: "AppError",
        message: "Missing complete item DTO.",
        stack: "Error: Missing complete item DTO.\n    at applyProjectChangeBatch",
      },
      route: "workbench",
      triggeringEvent: {
        topic: "project.data_changed",
        updatedSections: ["items"],
        projectRevision: 12,
      },
    });

    const [event] = log_manager.snapshot_events();
    const detail = event === undefined ? null : log_manager.read_detail(event.id);
    expect(response.status).toBe(200);
    expect(event).toMatchObject({ level: "error", source: "renderer" });
    expect(detail).toMatchObject({
      error: {
        name: "AppError",
        message: "Missing complete item DTO.",
        context: {
          renderer_source: "scheduler",
          route: "workbench",
          triggeringEvent: {
            topic: "project.data_changed",
            updatedSections: ["items"],
            projectRevision: 12,
          },
        },
      },
    });
  });

  it("事件流提供 keepalive 并在 Gateway 退出时关闭", async () => {
    const gateway = create_gateway();

    const started = await gateway.start();
    const stream = await read_http_stream_until(
      `${started.baseUrl}/api/events/stream`,
      "keepalive",
    );

    expect(stream).toMatchObject({ status: 200 });
    expect(stream.text).toContain(": keepalive");
    await expect(gateway.stop()).resolves.toBeUndefined();
  });

  it("stop 断开连接后仍等待已进入业务层的 POST handler", async () => {
    const console_error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const stderr_write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    cleanup_callbacks.push(
      () => stderr_write.mockRestore(),
      () => console_error.mockRestore(),
    );
    const fixture = create_gateway_fixture(create_app_root(), new ProjectDatabase());
    let mark_handler_started: () => void = () => undefined;
    const handler_started = new Promise<void>((resolve) => {
      mark_handler_started = resolve;
    });
    let release_handler: () => void = () => undefined;
    const handler_block = new Promise<void>((resolve) => {
      release_handler = resolve;
    });
    vi.spyOn(fixture.backend_services.model, "list_available_models").mockImplementation(
      async () => {
        mark_handler_started();
        await handler_block;
        return { models: [] };
      },
    );
    const started = await fixture.gateway.start();
    const request = post_json(started.baseUrl, "/api/models/list-available", {
      model_id: "blocked",
    }).then(
      () => undefined,
      () => undefined,
    );
    await handler_started;

    let stop_completed = false;
    const stopping = fixture.gateway.stop().then(() => {
      stop_completed = true;
    });
    await request;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(stop_completed).toBe(false);

    release_handler();
    await stopping;
    expect(stop_completed).toBe(true);
  });

  it("stop 只释放公开监听器，不越界释放 BackendServices", async () => {
    const dispose = vi.fn(async () => undefined);
    const gateway = new ApiGatewayServer({
      backendServices: { dispose } as unknown as BackendServices,
    });

    await gateway.stop();

    expect(dispose).not.toHaveBeenCalled();
  });

  it("重复启动保持同一本机入口且停止幂等", async () => {
    const gateway = create_gateway();
    const first = await gateway.start();

    await expect(gateway.start()).resolves.toEqual(first);
    await expect(gateway.stop()).resolves.toBeUndefined();
    await expect(gateway.stop()).resolves.toBeUndefined();
  });

  function create_gateway(): ApiGatewayServer {
    return create_gateway_fixture(create_app_root(), new ProjectDatabase()).gateway;
  }

  function create_gateway_fixture(
    app_root: string,
    database: ProjectDatabase,
    log_manager: LogManager = create_log_manager(app_root),
  ): { gateway: ApiGatewayServer; backend_services: BackendServices } {
    const paths = new AppPathService({ appRoot: app_root });
    const backend_services = new BackendServices({
      paths,
      metadata: new AppMetadataService(paths),
      appSettingService: new AppSettingService(paths),
      database,
      logManager: log_manager,
      systemProxySnapshot: null,
      openOutputFolder: async () => undefined,
      workerExecution: IN_PROCESS_WORKER_EXECUTION,
    });
    backend_services.start();
    const gateway = new ApiGatewayServer({ backendServices: backend_services });
    cleanup_callbacks.push(
      () => database.close(),
      () => backend_services.dispose(),
      () => gateway.stop(),
    );
    return { gateway, backend_services };
  }

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
      end: (callback?: () => void) => callback?.(),
    };
  }

  async function post_json(
    base_url: string,
    path_name: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    return await fetch(`${base_url}${path_name}`, {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
  }

  async function read_http_stream_until(
    url: string,
    expected_text: string,
  ): Promise<{ status: number; text: string }> {
    return await new Promise<{ status: number; text: string }>((resolve, reject) => {
      let settled = false;
      let text = "";
      const request = http.get(url, (response) => {
        const status = response.statusCode ?? 0;
        response.setEncoding("utf-8");
        response.on("data", (chunk: string) => {
          text += chunk;
          if (!settled && text.includes(expected_text)) {
            settled = true;
            clearTimeout(timeout_id);
            request.destroy();
            resolve({ status, text });
          }
        });
        response.on("end", () => {
          if (!settled) {
            settled = true;
            clearTimeout(timeout_id);
            reject(new Error(`事件流未收到 ${expected_text}。`));
          }
        });
      });
      const timeout_id = setTimeout(() => {
        if (!settled) {
          settled = true;
          request.destroy();
          reject(new Error(`事件流未收到 ${expected_text}。`));
        }
      }, 1000);
      request.on("error", (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout_id);
          reject(error);
        }
      });
    });
  }
});
