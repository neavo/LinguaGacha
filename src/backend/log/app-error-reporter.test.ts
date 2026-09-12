import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { AppError } from "../../shared/error";
import { LogManager } from "./log-manager";
import { record_app_error } from "./app-error-reporter";

describe("record_app_error", () => {
  it("按 AppError severity 选择日志等级并写入结构化上下文", async () => {
    using directory = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "log-error-"));
    const log_manager = new LogManager({
      consoleWriter: () => undefined,
      logDir: directory.path,
      now: () => new Date(2012, 11, 12, 12, 12, 12),
    });

    record_app_error(new AppError("model.provider_failed", { cause: new Error("provider boom") }), {
      logManager: log_manager,
      message: "模型请求失败",
      source: "test",
      context: { request_id: "request-1" },
    });

    const file_record = JSON.parse(
      fs.readFileSync(
        path.join(directory.path, `app.${log_manager.files.list_dates()[0]!}.jsonl`),
        "utf8",
      ),
    ) as Record<string, unknown>;
    expect(file_record["level"]).toBe("warning");
    expect(file_record["source"]).toBe("test");
    expect(file_record["error"]).toMatchObject({
      message: "model.provider_failed",
      context: {
        code: "model.provider_failed",
        request_id: "request-1",
        severity: "warning",
      },
    });
    expect(
      (
        await log_manager.files.read_page({
          date: log_manager.files.list_dates()[0]!,
          direction: "latest",
        })
      ).entries[0]?.level,
    ).toBe("warning");
  });

  it("expected 错误进入 debug 而不是 error", async () => {
    using directory = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "log-error-"));
    const log_manager = new LogManager({
      consoleWriter: () => undefined,
      logDir: directory.path,
    });

    record_app_error(new AppError("request.validation_failed"), {
      logManager: log_manager,
      message: "请求无效",
      source: "test",
    });

    expect(
      (
        await log_manager.files.read_page({
          date: log_manager.files.list_dates()[0]!,
          direction: "latest",
        })
      ).entries[0]?.level,
    ).toBe("debug");
  });
});
