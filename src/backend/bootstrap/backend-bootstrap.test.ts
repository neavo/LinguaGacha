import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getGlobalDispatcher } from "undici";

import {
  FileIoFailedError,
  InternalInvariantError,
  RuntimeDisposedError,
} from "../../shared/error";
import { AgentService } from "../agent/agent-service";
import { ApiGatewayServer } from "../api/api-gateway-server";
import { NPM_INITIAL_CWD_ENV_NAME } from "../app/app-root-resolver";
import { ProjectDatabase } from "../database/database-operations";
import { LogManager } from "../log/log-manager";
import { BackendBootstrap } from "./backend-bootstrap";
import type { BackendWorkerExecution } from "../worker/worker-execution";

let temp_dir = ""; // 承载测试应用根和数据根，避免 bootstrap 日志写入真实工作区
let original_initial_cwd: string | undefined; // 用于恢复 npm 启动目录，避免测试污染后续用例的应用根解析
const IN_PROCESS_WORKER_EXECUTION: BackendWorkerExecution = { kind: "in_process" }; // bootstrap 测试只验证启动编排，不启动真实 worker_threads

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
  const agent_resource_dir = path.join(temp_dir, "resource", "agent");
  fs.mkdirSync(agent_resource_dir, { recursive: true });
  fs.writeFileSync(path.join(agent_resource_dir, "system_prompt.md"), "基础系统指令。", "utf-8");
  fs.writeFileSync(path.join(temp_dir, "version.txt"), "9.8.7", "utf-8");
  original_initial_cwd = process.env[NPM_INITIAL_CWD_ENV_NAME];
  process.env[NPM_INITIAL_CWD_ENV_NAME] = temp_dir;
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  if (original_initial_cwd === undefined) {
    delete process.env[NPM_INITIAL_CWD_ENV_NAME];
  } else {
    process.env[NPM_INITIAL_CWD_ENV_NAME] = original_initial_cwd;
  }
  fs.rmSync(temp_dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("BackendBootstrap", () => {
  it("基础 system prompt 缺失时启动失败并释放已创建资源", async () => {
    fs.rmSync(path.join(temp_dir, "resource", "agent", "system_prompt.md"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const agent_dispose = vi.spyOn(AgentService.prototype, "dispose");
    const database_close = vi.spyOn(ProjectDatabase.prototype, "close");
    const log_shutdown = vi.spyOn(LogManager.prototype, "shutdown");
    const manager = new BackendBootstrap({
      appRoot: temp_dir,
      exposeApiGateway: false,
      openOutputFolder: noop_output_folder,
      workerExecution: IN_PROCESS_WORKER_EXECUTION,
    });

    await expect(manager.start()).rejects.toBeInstanceOf(FileIoFailedError);

    expect(agent_dispose).toHaveBeenCalledTimes(1);
    expect(database_close).toHaveBeenCalledTimes(1);
    expect(log_shutdown).toHaveBeenCalledTimes(1);
    expect(manager.isStopped()).toBe(true);
  });

  it("直接注入 ProjectDatabase 并只启动公开 API Gateway", async () => {
    const skill_dir = path.join(temp_dir, "resource", "agent", "skill", "test-skill");
    fs.mkdirSync(skill_dir, { recursive: true });
    fs.writeFileSync(
      path.join(skill_dir, "SKILL.md"),
      "---\nname: test-skill\ndescription: 启动期能力\n---\n\n执行测试任务。",
      "utf-8",
    );
    const manager = new BackendBootstrap({
      appRoot: temp_dir,
      exposeApiGateway: true,
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
      exposeApiGateway: true,
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
    expect(database_close).toHaveBeenCalledTimes(1);
    expect(log_shutdown).toHaveBeenCalledTimes(1);
    expect(backend_dispose.mock.invocationCallOrder[0]).toBeLessThan(
      database_close.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(database_close.mock.invocationCallOrder[0]).toBeLessThan(
      log_shutdown.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it("并发 stop 共享同一次关闭并等待完整资源链", async () => {
    const manager = new BackendBootstrap({
      appRoot: temp_dir,
      exposeApiGateway: false,
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
      exposeApiGateway: false,
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
      exposeApiGateway: true,
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
      exposeApiGateway: true,
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

    expect(start_error).toBeInstanceOf(RuntimeDisposedError);
    expect(start_error).toMatchObject({
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
      exposeApiGateway: true,
      logTargets: { console: false, window: false },
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
      exposeApiGateway: true,
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

      expect(repeated_start_error).toBeInstanceOf(InternalInvariantError);
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
      exposeApiGateway: false,
      logTargets: { console: false, window: false },
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

  it("启动期按当前模型 URL 抓取一次系统代理快照", async () => {
    fs.mkdirSync(path.join(temp_dir, "userdata"), { recursive: true });
    fs.writeFileSync(
      path.join(temp_dir, "userdata", "config.json"),
      JSON.stringify({
        model_selection: {
          translation: "openai-custom",
          analysis: "openai-custom",
          agent: "openai-custom",
        },
        models: [
          {
            id: "openai-custom",
            api_format: "OpenAI",
            api_url: "https://api.example/v1/chat/completions",
          },
          {
            id: "local-sakura",
            api_format: "SakuraLLM",
            api_url: "http://127.0.0.1:8080",
          },
        ],
      }),
      "utf-8",
    );
    const resolved_urls: string[] = []; // 记录启动期 resolveProxy 调用顺序，证明不会按请求反复探测
    const manager = new BackendBootstrap({
      appRoot: temp_dir,
      exposeApiGateway: false,
      logTargets: { console: false, window: false },
      systemProxyResolver: {
        resolveProxy: async (url) => {
          resolved_urls.push(url);
          return "DIRECT";
        },
      },
      openOutputFolder: noop_output_folder,
      workerExecution: IN_PROCESS_WORKER_EXECUTION,
    });

    await manager.start();
    try {
      expect(resolved_urls).toEqual([
        "https://api.example/v1/chat/completions",
        "https://generativelanguage.googleapis.com",
        "https://api.openai.com/v1",
        "https://api.anthropic.com",
      ]);
      expect(read_log_text(path.join(temp_dir, "log"))).not.toContain("检查到系统代理设置");
    } finally {
      await manager.stop();
    }
  });

  it("系统代理解析失败不阻断 Backend 启动", async () => {
    const manager = new BackendBootstrap({
      appRoot: temp_dir,
      exposeApiGateway: false,
      logTargets: { console: false, window: false },
      systemProxyResolver: {
        resolveProxy: async () => {
          throw new Error("resolve failed");
        },
      },
      openOutputFolder: noop_output_folder,
      workerExecution: IN_PROCESS_WORKER_EXECUTION,
    });

    const start_result = await manager.start();
    try {
      expect(start_result.systemProxyStartupNotice).toEqual({
        detected: false,
        proxiedOriginCount: 0,
        proxyDisplay: null,
      });
      const log_text = read_log_text(path.join(temp_dir, "log"));
      expect(log_text).toContain("LinguaGacha v9.8.7 …");
      expect(log_text).not.toContain("检查到系统代理设置");
    } finally {
      await manager.stop();
    }
  });

  it("检测到系统代理时返回启动提示摘要并写入脱敏日志", async () => {
    fs.mkdirSync(path.join(temp_dir, "userdata"), { recursive: true });
    fs.writeFileSync(
      path.join(temp_dir, "userdata", "config.json"),
      JSON.stringify({
        models: [
          {
            id: "openai-custom",
            api_format: "OpenAI",
            api_url: "https://api.example/v1/chat/completions",
          },
        ],
      }),
      "utf-8",
    );
    const original_dispatcher = getGlobalDispatcher();
    const manager = new BackendBootstrap({
      appRoot: temp_dir,
      exposeApiGateway: false,
      logTargets: { console: false, window: false },
      systemProxyResolver: {
        resolveProxy: async () => "PROXY 127.0.0.1:7890",
      },
      openOutputFolder: noop_output_folder,
      workerExecution: IN_PROCESS_WORKER_EXECUTION,
    });

    const start_result = await manager.start();
    try {
      expect(getGlobalDispatcher()).not.toBe(original_dispatcher);
      expect(start_result.systemProxyStartupNotice).toEqual({
        detected: true,
        proxiedOriginCount: 4,
        proxyDisplay: "http://127.0.0.1:7890",
      });
      const log_text = read_log_text(path.join(temp_dir, "log"));

      expect(log_text).toContain("检查到系统代理设置 - http://127.0.0.1:7890");
      expect(log_text).not.toContain("http://127.0.0.1:7890/");
    } finally {
      await manager.stop();
    }
    expect(getGlobalDispatcher()).toBe(original_dispatcher);
  });
});

async function noop_output_folder(_output_path: string): Promise<void> {}
