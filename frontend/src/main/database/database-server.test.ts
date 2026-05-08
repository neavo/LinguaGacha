import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { JsonTool } from "../../utils/json-tool";
import { type FileLogWriter, LogManager } from "../log/log-manager";
import { set_electron_main_log_manager } from "../log/log-bridge";
import { DatabaseServer } from "./database-server";

function request_database_health(
  base_url: string,
  token: string,
): Promise<{
  statusCode: number;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      `${base_url}/internal/database/health`,
      {
        headers: { "X-LinguaGacha-Database-Token": token },
        method: "GET",
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf-8"),
          });
        });
      },
    );
    request.on("error", reject);
    request.end();
  });
}

describe("DatabaseServer", () => {
  const cleanup_callbacks: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    set_electron_main_log_manager(null);
    while (cleanup_callbacks.length > 0) {
      const cleanup = cleanup_callbacks.pop();
      await cleanup?.();
    }
  });

  it("校验 token 并提供统一 JSON 响应壳", async () => {
    const server = new DatabaseServer();
    const start_result = await server.start();

    try {
      const unauthorized = await request_database_health(start_result.baseUrl, "bad");
      expect(unauthorized.statusCode).toBe(401);

      const ok = await request_database_health(start_result.baseUrl, start_result.token);
      expect(JsonTool.parseStrict(ok.body)).toEqual({ ok: true, data: { status: "ok" } });
    } finally {
      await server.stop();
    }
  });

  it("内部错误写入 Electron main 日志", async () => {
    const log_manager = create_log_manager();
    set_electron_main_log_manager(log_manager);
    const server = new DatabaseServer();
    const start_result = await server.start();

    try {
      const response = await request_database_post(
        `${start_result.baseUrl}/internal/database/op`,
        start_result.token,
        { name: "missingOperation", args: {} },
      );

      expect(response.statusCode).toBe(500);
      expect(log_manager.snapshot_events().map((event) => event.message)).toContain(
        "Database Service 请求处理失败",
      );
    } finally {
      await server.stop();
    }
  });

  function create_log_manager(): LogManager {
    const log_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-db-log-test-"));
    cleanup_callbacks.push(() => fs.rmSync(log_dir, { force: true, recursive: true }));
    const log_manager = new LogManager({
      consoleWriter: () => undefined,
      fileWriter: create_memory_file_writer(),
      logDir: log_dir,
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
});

function request_database_post(
  url: string,
  token: string,
  body: unknown,
): Promise<{
  statusCode: number;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const raw_body = JsonTool.stringifyStrict(body);
    const request = http.request(
      url,
      {
        headers: {
          "Content-Length": Buffer.byteLength(raw_body).toString(),
          "Content-Type": "application/json",
          "X-LinguaGacha-Database-Token": token,
        },
        method: "POST",
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf-8"),
          });
        });
      },
    );
    request.on("error", reject);
    request.end(raw_body);
  });
}
