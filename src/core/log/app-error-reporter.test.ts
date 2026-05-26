import { describe, expect, it } from "vitest";

import { ModelProviderFailedError, RequestValidationError } from "../../shared/error";
import { LogManager, type FileLogWriter } from "./log-manager";
import { record_app_error } from "./app-error-reporter";

describe("record_app_error", () => {
  it("按 AppError severity 选择日志等级并写入结构化上下文", () => {
    const events: string[] = [];
    const log_manager = new LogManager({
      consoleWriter: (text) => events.push(text),
      fileWriter: create_memory_file_writer(events),
      logDir: ".",
      now: () => new Date(2012, 11, 12, 12, 12, 12),
    });

    record_app_error(new ModelProviderFailedError({ cause: new Error("provider boom") }), {
      logManager: log_manager,
      message: "模型请求失败",
      source: "test",
      context: { request_id: "request-1" },
    });

    const file_record = JSON.parse(events[0] ?? "{}") as Record<string, unknown>;
    expect(file_record["level_label"]).toBe("warning");
    expect(file_record["source"]).toBe("test");
    expect(file_record["error"]).toMatchObject({
      message: "model.provider_failed",
      context: {
        code: "model.provider_failed",
        request_id: "request-1",
        severity: "warning",
      },
    });
    expect(log_manager.snapshot_events()[0]?.level).toBe("warning");
  });

  it("expected 错误进入 debug 而不是 error", () => {
    const events: string[] = [];
    const log_manager = new LogManager({
      consoleWriter: (text) => events.push(text),
      fileWriter: create_memory_file_writer(events),
      logDir: ".",
    });

    record_app_error(new RequestValidationError(), {
      logManager: log_manager,
      message: "请求无效",
      source: "test",
    });

    expect(log_manager.snapshot_events()[0]?.level).toBe("debug");
  });

  function create_memory_file_writer(lines: string[]): FileLogWriter {
    return {
      write: (text) => lines.push(text),
      flush: () => undefined,
      flushSync: () => undefined,
      end: (callback?: () => void) => {
        callback?.();
      },
    };
  }
});
