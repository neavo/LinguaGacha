import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { format_log_date_key, type FileLogWriter, LogManager } from "./log-manager";

describe("LogManager", () => {
  const cleanup_callbacks: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanup_callbacks.length > 0) {
      const cleanup = cleanup_callbacks.pop();
      await cleanup?.();
    }
  });

  it("把窗口日志写入 ring buffer 并按订阅回放", () => {
    const log_manager = create_log_manager();
    const received: string[] = [];

    log_manager.info("第一条", { targets: { file: false, console: false } });
    log_manager.subscribe((event) => {
      received.push(event.message);
    });
    log_manager.warning("第二条", { targets: { file: false, console: false } });

    expect(received).toEqual(["第一条", "第二条"]);
    expect(log_manager.snapshot_events().map((event) => event.sequence)).toEqual([1, 2]);
  });

  it("目标开关可以分别关闭文件、控制台和窗口输出", () => {
    const console_lines: string[] = [];
    const log_manager = create_log_manager(console_lines);

    log_manager.error("只写文件", {
      targets: { console: false, window: false },
    });

    expect(console_lines).toEqual([]);
    expect(log_manager.snapshot_events()).toEqual([]);
  });

  it("ring buffer 只保留最近固定数量", () => {
    const log_manager = create_log_manager([], 2);

    log_manager.info("一", { targets: { file: false, console: false } });
    log_manager.info("二", { targets: { file: false, console: false } });
    log_manager.info("三", { targets: { file: false, console: false } });

    expect(log_manager.snapshot_events().map((event) => event.message)).toEqual(["二", "三"]);
  });

  it("真实文件输出按 app.yyyymmdd.log 写入结构化日志", async () => {
    const log_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-log-file-test-"));
    const now = new Date(2012, 11, 12, 8, 0, 0);
    cleanup_callbacks.push(() => fs.rmSync(log_dir, { force: true, recursive: true }));
    const log_manager = new LogManager({
      consoleWriter: () => undefined,
      logDir: log_dir,
      now: () => now,
    });
    cleanup_callbacks.push(() => log_manager.shutdown());

    log_manager.error("文件日志", {
      error_message: "boom",
      source: "test",
      targets: { console: false, window: false },
    });
    await log_manager.shutdown();
    const log_file_name = `app.${format_log_date_key(now)}.log`;
    const text = fs.readFileSync(path.join(log_dir, log_file_name), "utf-8").trim();
    const record = JSON.parse(text) as Record<string, unknown>;

    expect(log_file_name).toBe("app.20121212.log");
    expect(record["message"]).toBe("文件日志");
    expect(record["level"]).toBe(50);
    expect(record["level_label"]).toBe("error");
    expect(record["time"]).toBe(now.toISOString());
    expect(record["source"]).toBe("test");
    expect(record["error_message"]).toBe("boom");
  });

  it("磁盘日志只保留最近 3 份 app.yyyymmdd.log", async () => {
    const log_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-log-retention-test-"));
    const now = new Date(2012, 11, 12, 8, 0, 0);
    cleanup_callbacks.push(() => fs.rmSync(log_dir, { force: true, recursive: true }));
    for (const file_name of [
      "app.20121208.log",
      "app.20121209.log",
      "app.20121210.log",
      "app.20121211.log",
      "debug.log",
    ]) {
      fs.writeFileSync(path.join(log_dir, file_name), "old\n", "utf-8");
    }
    const log_manager = new LogManager({
      consoleWriter: () => undefined,
      logDir: log_dir,
      now: () => now,
    });
    cleanup_callbacks.push(() => log_manager.shutdown());

    log_manager.info("触发清理", { targets: { console: false, window: false } });
    await log_manager.shutdown();

    expect(fs.readdirSync(log_dir).sort()).toEqual([
      "app.20121210.log",
      "app.20121211.log",
      "app.20121212.log",
      "debug.log",
    ]);
  });

  function create_log_manager(
    console_lines: string[] = [],
    ring_buffer_size = 1000,
    now?: () => Date,
  ): LogManager {
    const log_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-log-test-"));
    cleanup_callbacks.push(() => fs.rmSync(log_dir, { force: true, recursive: true }));
    const log_manager = new LogManager({
      consoleWriter: (text) => {
        console_lines.push(text);
      },
      fileWriter: create_memory_file_writer(),
      logDir: log_dir,
      now,
      ringBufferSize: ring_buffer_size,
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
