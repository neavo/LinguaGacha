import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentService } from "../agent/agent-service";
import { ApiGatewayServer } from "../api/api-gateway-server";
import { ProjectDatabase } from "../database/database-operations";
import { LogManager } from "../log/log-manager";
import { SystemProxyHttpClient } from "../network/system-proxy-http-client";
import { BackendBootstrap } from "./backend-bootstrap";
import type { BackendWorkerExecution } from "../worker/worker-execution";

let temp_dir = ""; // 承载测试应用根和数据根，避免 bootstrap 日志写入真实工作区
const IN_PROCESS_WORKER_EXECUTION: BackendWorkerExecution = { kind: "in_process" }; // bootstrap 测试只验证启动编排，不启动真实 worker_threads
const DIRECT_SYSTEM_PROXY_RESOLVER = { resolveProxy: async () => "DIRECT" };

/**
 * 读取 bootstrap 测试写出的日志文本，用于确认启动链路不再记录旧 database HTTP 服务
 */
function read_log_text(log_dir: string): string {
  if (!fs.existsSync(log_dir)) {
    return "";
  }
  return fs
    .readdirSync(log_dir)
    .filter((file_name) => file_name.endsWith(".log"))
    .map((file_name) => fs.readFileSync(path.join(log_dir, file_name), "utf-8"))
    .join("\n");
}

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-lifecycle-"));
  const agent_builtin_dir = path.join(temp_dir, "builtin", "agent");
  fs.mkdirSync(agent_builtin_dir, { recursive: true });
  fs.writeFileSync(path.join(agent_builtin_dir, "system_prompt.md"), "基础系统指令。", "utf-8");
  fs.writeFileSync(
    path.join(agent_builtin_dir, "session_seed.json"),
    JSON.stringify([
      { role: "user", content: "种子设定。" },
      { role: "assistant", content: "种子确认。" },
    ]),
    "utf-8",
  );
  fs.writeFileSync(path.join(temp_dir, "version.txt"), "9.8.7", "utf-8");
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  fs.rmSync(temp_dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("BackendBootstrap", () => {
  it("基础 system prompt 缺失时启动失败并释放已创建资源", async () => {
    fs.rmSync(path.join(temp_dir, "builtin", "agent", "system_prompt.md"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const agent_dispose = vi.spyOn(AgentService.prototype, "dispose");
    const http_dispose = vi.spyOn(SystemProxyHttpClient.prototype, "dispose");
    const database_close = vi.spyOn(ProjectDatabase.prototype, "close");
    const log_shutdown = vi.spyOn(LogManager.prototype, "shutdown");
    const manager = new BackendBootstrap({
      appRoot: temp_dir,
      builtinRoot: path.join(temp_dir, "builtin"),
      exposeApiGateway: false,
      systemProxyResolver: DIRECT_SYSTEM_PROXY_RESOLVER,
      openOutputFolder: noop_output_folder,
      workerExecution: IN_PROCESS_WORKER_EXECUTION,
    });

    await expect(manager.start()).rejects.toMatchObject({ code: "file.io_failed" });

    expect(agent_dispose).toHaveBeenCalledTimes(1);
    expect(http_dispose).toHaveBeenCalledTimes(1);
    expect(database_close).toHaveBeenCalledTimes(1);
    expect(log_shutdown).toHaveBeenCalledTimes(1);
    expect(manager.isStopped()).toBe(true);
  });

  it("直接注入 ProjectDatabase 并只启动公开 API Gateway", async () => {
    const skill_dir = path.join(temp_dir, "builtin", "agent", "skill", "test-skill");
    fs.mkdirSync(skill_dir, { recursive: true });
    fs.writeFileSync(
      path.join(skill_dir, "SKILL.md"),
      "---\nname: test-skill\ndescription: 启动期能力\n---\n\n执行测试任务。",
      "utf-8",
    );
    const manager = new BackendBootstrap({
      appRoot: temp_dir,
      builtinRoot: path.join(temp_dir, "builtin"),
      exposeApiGateway: true,
      systemProxyResolver: DIRECT_SYSTEM_PROXY_RESOLVER,
      openOutputFolder: noop_output_folder,
      workerExecution: IN_PROCESS_WORKER_EXECUTION,
    });

    const start_result = await manager.start();
    try {
      expect(start_result.apiBaseUrl).not.toBeNull();
      const health_response = await fetch(`${start_result.apiBaseUrl ?? ""}/api/health`);

      expect(await health_response.json()).toEqual({
        ok: true,
        data: {
          service: "linguagacha-backend",
          status: "ok",
          version: "9.8.7",
        },
      });
      expect(start_result.readAppLanguage()).toBe("ZH");
      expect(start_result.backendServices.agent.get_snapshot().skills).toEqual([
        {
          name: "test-skill",
          displayDescriptions: {
            "zh-CN": "启动期能力",
            "en-US": "启动期能力",
            "de-DE": "启动期能力",
          },
        },
      ]);

      const log_text = read_log_text(path.join(temp_dir, "log"));
      expect(log_text.indexOf('"message":""')).toBeLessThan(
        log_text.indexOf("LinguaGacha v9.8.7 …"),
      );
      expect(log_text).toContain("LinguaGacha v9.8.7 …");
      expect(log_text.indexOf("LinguaGacha v9.8.7 …")).toBeLessThan(
        log_text.indexOf("API Gateway 已启动"),
      );
      expect(log_text).toContain("API Gateway 已启动");
      expect(log_text.indexOf("API Gateway 已启动")).toBeLessThan(
        log_text.lastIndexOf('"message":""'),
      );
      expect(log_text).not.toContain("ProjectDatabase 已就绪");
      expect(log_text).not.toContain("Database Service 已启动");
    } finally {
      await manager.stop();
    }
  });

  it("停止时等待 Gateway 在途 handler，再按 Backend、数据库、日志逆序释放", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const manager = new BackendBootstrap({
      appRoot: temp_dir,
      builtinRoot: path.join(temp_dir, "builtin"),
      exposeApiGateway: true,
      systemProxyResolver: DIRECT_SYSTEM_PROXY_RESOLVER,
      openOutputFolder: noop_output_folder,
      workerExecution: IN_PROCESS_WORKER_EXECUTION,
    });
    const start_result = await manager.start();
    let mark_handler_started: () => void = () => undefined;
    const handler_started = new Promise<void>((resolve) => {
      mark_handler_started = resolve;
    });
    let release_handler: () => void = () => undefined;
    const handler_block = new Promise<void>((resolve) => {
      release_handler = resolve;
    });
    vi.spyOn(start_result.backendServices.model, "list_available_models").mockImplementation(
      async () => {
        mark_handler_started();
        await handler_block;
        return { models: [] };
      },
    );
    const database_close = vi.spyOn(ProjectDatabase.prototype, "close");
    const log_shutdown = vi.spyOn(LogManager.prototype, "shutdown");
    const request = fetch(`${start_result.apiBaseUrl ?? ""}/api/models/list-available`, {
      body: JSON.stringify({ model_id: "blocked" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }).then(
      () => undefined,
      () => undefined,
    );
    await handler_started;
    const backend_dispose = vi.spyOn(start_result.backendServices, "dispose");
    const http_dispose = vi.spyOn(SystemProxyHttpClient.prototype, "dispose");

    const stopping = manager.stop();
    try {
      await request;
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(backend_dispose).not.toHaveBeenCalled();
      expect(database_close).not.toHaveBeenCalled();
      expect(log_shutdown).not.toHaveBeenCalled();
    } finally {
      release_handler();
      await stopping;
    }

    expect(backend_dispose).toHaveBeenCalledTimes(1);
    expect(http_dispose).toHaveBeenCalledTimes(1);
    expect(database_close).toHaveBeenCalledTimes(1);
    expect(log_shutdown).toHaveBeenCalledTimes(1);
    expect(backend_dispose.mock.invocationCallOrder[0]).toBeLessThan(
      http_dispose.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(http_dispose.mock.invocationCallOrder[0]).toBeLessThan(
      database_close.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(database_close.mock.invocationCallOrder[0]).toBeLessThan(
      log_shutdown.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it("并发 stop 共享同一次关闭并等待完整资源链", async () => {
    const manager = new BackendBootstrap({
      appRoot: temp_dir,
      builtinRoot: path.join(temp_dir, "builtin"),
      exposeApiGateway: false,
      systemProxyResolver: DIRECT_SYSTEM_PROXY_RESOLVER,
      openOutputFolder: noop_output_folder,
      workerExecution: IN_PROCESS_WORKER_EXECUTION,
    });
    const start_result = await manager.start();
    const original_dispose = start_result.backendServices.dispose.bind(
      start_result.backendServices,
    );
    let mark_dispose_started: () => void = () => undefined;
    const dispose_started = new Promise<void>((resolve) => {
      mark_dispose_started = resolve;
    });
    let release_dispose: () => void = () => undefined;
    const dispose_block = new Promise<void>((resolve) => {
      release_dispose = resolve;
    });
    const backend_dispose = vi
      .spyOn(start_result.backendServices, "dispose")
      .mockImplementation(async () => {
        mark_dispose_started();
        await dispose_block;
        await original_dispose();
      });
    let first_completed = false;
    let second_completed = false;
    const first_stopping = manager.stop().then(() => {
      first_completed = true;
    });
    await dispose_started;
    const second_stopping = manager.stop().then(() => {
      second_completed = true;
    });

    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(first_completed).toBe(false);
      expect(second_completed).toBe(false);
      expect(backend_dispose).toHaveBeenCalledTimes(1);
    } finally {
      release_dispose();
      await Promise.all([first_stopping, second_stopping]);
    }

    expect(first_completed).toBe(true);
    expect(second_completed).toBe(true);
    expect(backend_dispose).toHaveBeenCalledTimes(1);
    expect(manager.isStopped()).toBe(true);
  });

  it("单个关闭步骤失败仍继续释放数据库和日志并汇总异常", async () => {
    const manager = new BackendBootstrap({
      appRoot: temp_dir,
      builtinRoot: path.join(temp_dir, "builtin"),
      exposeApiGateway: false,
      systemProxyResolver: DIRECT_SYSTEM_PROXY_RESOLVER,
      openOutputFolder: noop_output_folder,
      workerExecution: IN_PROCESS_WORKER_EXECUTION,
    });
    const start_result = await manager.start();
    const original_dispose = start_result.backendServices.dispose.bind(
      start_result.backendServices,
    );
    const dispose_failure = new Error("backend dispose failed");
    const backend_dispose = vi
      .spyOn(start_result.backendServices, "dispose")
      .mockImplementation(async () => {
        await original_dispose();
        throw dispose_failure;
      });
    const database_close = vi.spyOn(ProjectDatabase.prototype, "close");
    const log_shutdown = vi.spyOn(LogManager.prototype, "shutdown");
    let stop_error: unknown;

    try {
      await manager.stop();
    } catch (error) {
      stop_error = error;
    }

    expect(stop_error).toBeInstanceOf(AggregateError);
    expect((stop_error as AggregateError).errors).toEqual([dispose_failure]);
    expect(backend_dispose).toHaveBeenCalledTimes(1);
    expect(database_close).toHaveBeenCalledTimes(1);
    expect(log_shutdown).toHaveBeenCalledTimes(1);
    expect(backend_dispose.mock.invocationCallOrder[0]).toBeLessThan(
      database_close.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(database_close.mock.invocationCallOrder[0]).toBeLessThan(
      log_shutdown.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(manager.isStopped()).toBe(true);
    await expect(manager.stop()).resolves.toBeUndefined();
  });

  it("启动错误日志写入失败时仍完成资源收尾并保留全部异常", async () => {
    const start_failure = new Error("gateway start failed");
    const log_failure = new Error("bootstrap error log failed");
    vi.spyOn(ApiGatewayServer.prototype, "start").mockRejectedValue(start_failure);
    vi.spyOn(LogManager.prototype, "error").mockImplementationOnce(() => {
      throw log_failure;
    });
    const database_close = vi.spyOn(ProjectDatabase.prototype, "close");
    const log_shutdown = vi.spyOn(LogManager.prototype, "shutdown");
    const manager = new BackendBootstrap({
      appRoot: temp_dir,
      builtinRoot: path.join(temp_dir, "builtin"),
      exposeApiGateway: true,
      systemProxyResolver: DIRECT_SYSTEM_PROXY_RESOLVER,
      openOutputFolder: noop_output_folder,
      workerExecution: IN_PROCESS_WORKER_EXECUTION,
    });
    let start_error: unknown;

    try {
      await manager.start();
    } catch (error) {
      start_error = error;
    }

    expect(start_error).toBeInstanceOf(AggregateError);
    expect((start_error as AggregateError).errors).toEqual([start_failure, log_failure]);
    expect(database_close).toHaveBeenCalledTimes(1);
    expect(log_shutdown).toHaveBeenCalledTimes(1);
    expect(manager.isStopped()).toBe(true);
  });

  it("启动进行中收到 stop 时不发布可用结果，并在启动资源落位后立即关闭", async () => {
    let mark_gateway_start_entered: () => void = () => undefined;
    const gateway_start_entered = new Promise<void>((resolve) => {
      mark_gateway_start_entered = resolve;
    });
    let release_gateway_start: () => void = () => undefined;
    const gateway_start_block = new Promise<void>((resolve) => {
      release_gateway_start = resolve;
    });
    vi.spyOn(ApiGatewayServer.prototype, "start").mockImplementation(async () => {
      mark_gateway_start_entered();
      await gateway_start_block;
      return { baseUrl: "http://127.0.0.1:65535" };
    });
    const gateway_stop = vi.spyOn(ApiGatewayServer.prototype, "stop");
    const manager = new BackendBootstrap({
      appRoot: temp_dir,
      builtinRoot: path.join(temp_dir, "builtin"),
      exposeApiGateway: true,
      systemProxyResolver: DIRECT_SYSTEM_PROXY_RESOLVER,
      openOutputFolder: noop_output_folder,
      workerExecution: IN_PROCESS_WORKER_EXECUTION,
    });
    const starting = manager.start();
    await gateway_start_entered;
    let stop_completed = false;
    const stopping = manager.stop().then(() => {
      stop_completed = true;
    });

    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(stop_completed).toBe(false);
      expect(gateway_stop).not.toHaveBeenCalled();
    } finally {
      release_gateway_start();
    }

    let start_error: unknown;
    try {
      await starting;
    } catch (error) {
      start_error = error;
    }
    await stopping;

    expect(start_error).toMatchObject({
      code: "runtime.disposed",
      diagnostic_context: {
        reason: "backend_bootstrap_stopped_during_start",
      },
    });
    expect(gateway_stop).toHaveBeenCalledTimes(1);
    expect(stop_completed).toBe(true);
    expect(manager.isStopped()).toBe(true);
  });

  it("旧 stop Promise 完整结束前拒绝启动下一代资源", async () => {
    const first_start_failure = new Error("first gateway start failed");
    let mark_first_start_entered: () => void = () => undefined;
    const first_start_entered = new Promise<void>((resolve) => {
      mark_first_start_entered = resolve;
    });
    let reject_first_start: () => void = () => undefined;
    const first_start_block = new Promise<void>((_resolve, reject) => {
      reject_first_start = () => reject(first_start_failure);
    });
    let gateway_start_count = 0;
    vi.spyOn(ApiGatewayServer.prototype, "start").mockImplementation(async () => {
      gateway_start_count += 1;
      if (gateway_start_count === 1) {
        mark_first_start_entered();
        await first_start_block;
      }
      return { baseUrl: "http://127.0.0.1:65535" };
    });
    const manager = new BackendBootstrap({
      appRoot: temp_dir,
      builtinRoot: path.join(temp_dir, "builtin"),
      exposeApiGateway: true,
      logTargets: { console: false, window: false },
      systemProxyResolver: DIRECT_SYSTEM_PROXY_RESOLVER,
      openOutputFolder: noop_output_folder,
      workerExecution: IN_PROCESS_WORKER_EXECUTION,
    });
    const first_starting = manager.start();
    let restart_during_old_stop: Promise<unknown> | null = null;
    const observed_first_starting = first_starting.catch((error: unknown) => {
      restart_during_old_stop = manager.start().then(
        () => null,
        (restart_error: unknown) => restart_error,
      );
      throw error;
    });
    await first_start_entered;
    const first_stopping = manager.stop();
    reject_first_start();

    await expect(observed_first_starting).rejects.toBe(first_start_failure);
    expect(restart_during_old_stop).not.toBeNull();
    await expect(restart_during_old_stop).resolves.toMatchObject({
      diagnostic_context: {
        reason: "backend_bootstrap_start_invalid_state",
        state: "stopped",
        stop_in_progress: true,
      },
    });
    expect(gateway_start_count).toBe(1);

    await first_stopping;
    await expect(manager.start()).resolves.toMatchObject({
      apiBaseUrl: "http://127.0.0.1:65535",
    });
    expect(gateway_start_count).toBe(2);
    await manager.stop();
  });

  it("禁止 ready 状态重复进入启动链路", async () => {
    const manager = new BackendBootstrap({
      appRoot: temp_dir,
      builtinRoot: path.join(temp_dir, "builtin"),
      exposeApiGateway: true,
      systemProxyResolver: DIRECT_SYSTEM_PROXY_RESOLVER,
      openOutputFolder: noop_output_folder,
      workerExecution: IN_PROCESS_WORKER_EXECUTION,
    });

    await manager.start();
    try {
      let repeated_start_error: unknown;
      try {
        await manager.start();
      } catch (error) {
        repeated_start_error = error;
      }

      expect(repeated_start_error).toMatchObject({
        code: "runtime.internal_invariant",
        diagnostic_context: {
          reason: "backend_bootstrap_start_invalid_state",
          state: "ready",
        },
      });
    } finally {
      await manager.stop();
    }
  });

  it("入口可关闭控制台日志并保留文件日志", async () => {
    const stdout_write = vi.mocked(process.stdout.write);
    stdout_write.mockClear();
    const manager = new BackendBootstrap({
      appRoot: temp_dir,
      builtinRoot: path.join(temp_dir, "builtin"),
      exposeApiGateway: false,
      logTargets: { console: false, window: false },
      systemProxyResolver: DIRECT_SYSTEM_PROXY_RESOLVER,
      openOutputFolder: noop_output_folder,
      workerExecution: IN_PROCESS_WORKER_EXECUTION,
    });

    await manager.start();
    try {
      expect(stdout_write).not.toHaveBeenCalled();
      expect(read_log_text(path.join(temp_dir, "log"))).toContain("LinguaGacha v9.8.7 …");
    } finally {
      await manager.stop();
    }
  });

  it("启动不提前解析系统代理", async () => {
    const resolve_proxy = vi.fn(async () => "DIRECT");
    const manager = new BackendBootstrap({
      appRoot: temp_dir,
      builtinRoot: path.join(temp_dir, "builtin"),
      exposeApiGateway: false,
      logTargets: { console: false, window: false },
      systemProxyResolver: { resolveProxy: resolve_proxy },
      openOutputFolder: noop_output_folder,
      workerExecution: IN_PROCESS_WORKER_EXECUTION,
    });

    await manager.start();
    try {
      expect(resolve_proxy).not.toHaveBeenCalled();
    } finally {
      await manager.stop();
    }
  });
});

async function noop_output_folder(_output_path: string): Promise<void> {}
