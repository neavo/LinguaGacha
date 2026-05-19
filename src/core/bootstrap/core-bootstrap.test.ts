import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NPM_INITIAL_CWD_ENV_NAME } from "./core-app-root-resolver";
import { CoreBootstrap } from "./core-bootstrap";
import { InternalInvariantError } from "../../shared/error";
import type { EngineExecution } from "../engine/core/engine-execution";

let temp_dir = ""; // temp_dir 承载测试应用根和数据根，避免 bootstrap 日志写入真实工作区
let original_initial_cwd: string | undefined; // original_initial_cwd 用于恢复 npm 启动目录，避免测试污染后续用例的应用根解析
const IN_PROCESS_ENGINE_EXECUTION: EngineExecution = { kind: "in_process" }; // bootstrap 测试只验证启动编排，不启动真实 worker_threads

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
  fs.mkdirSync(path.join(temp_dir, "resource"), { recursive: true });
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

describe("CoreBootstrap", () => {
  it("直接注入 ProjectDatabase 并只启动公开 API Gateway", async () => {
    const manager = new CoreBootstrap({
      appRoot: temp_dir,
      exposeApiGateway: true,
      openOutputFolder: noop_output_folder,
      engineExecution: IN_PROCESS_ENGINE_EXECUTION,
    });

    const start_result = await manager.start();
    try {
      expect(start_result.apiBaseUrl).not.toBeNull();
      const health_response = await fetch(`${start_result.apiBaseUrl ?? ""}/api/health`);

      expect(await health_response.json()).toEqual({
        ok: true,
        data: {
          service: "linguagacha-core",
          status: "ok",
          version: "9.8.7",
        },
      });
      expect(start_result.readAppLanguage()).toBe("ZH");

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

  it("禁止 ready 状态重复进入启动链路", async () => {
    const manager = new CoreBootstrap({
      appRoot: temp_dir,
      exposeApiGateway: true,
      openOutputFolder: noop_output_folder,
      engineExecution: IN_PROCESS_ENGINE_EXECUTION,
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
          reason: "core_bootstrap_start_invalid_state",
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
    const manager = new CoreBootstrap({
      appRoot: temp_dir,
      exposeApiGateway: false,
      logTargets: { console: false, window: false },
      openOutputFolder: noop_output_folder,
      engineExecution: IN_PROCESS_ENGINE_EXECUTION,
    });

    await manager.start();
    try {
      expect(stdout_write).not.toHaveBeenCalled();
      expect(read_log_text(path.join(temp_dir, "log"))).toContain("LinguaGacha v9.8.7 …");
    } finally {
      await manager.stop();
    }
  });
});

async function noop_output_folder(_output_path: string): Promise<void> {}
