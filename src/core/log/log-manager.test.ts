import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { afterEach, describe, expect, it, vi } from "vitest";

import { LOG_WINDOW_EVENT_CAPACITY } from "../../shared/log";
import { format_log_date_key, type FileLogWriter, LogManager } from "./log-manager";

describe("LogManager", () => {
  const cleanup_callbacks: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanup_callbacks.length > 0) {
      const cleanup = cleanup_callbacks.pop();
      await cleanup?.();
    }
    vi.restoreAllMocks();
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
    const file_lines: string[] = [];
    const log_manager = create_log_manager(
      console_lines,
      LOG_WINDOW_EVENT_CAPACITY,
      undefined,
      file_lines,
    );

    log_manager.error("只写文件", {
      targets: { console: false, window: false },
    });

    const file_record = JSON.parse(file_lines[0] ?? "{}") as Record<string, unknown>;
    expect(file_record["message"]).toBe("只写文件");
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

  it("订阅取消后不再接收新的窗口日志", () => {
    const log_manager = create_log_manager();
    const received: string[] = [];
    const unsubscribe = log_manager.subscribe((event) => {
      received.push(event.message);
    });

    log_manager.info("订阅期日志", { targets: { file: false, console: false } });
    unsubscribe();
    log_manager.info("取消后日志", { targets: { file: false, console: false } });

    expect(received).toEqual(["订阅期日志"]);
    expect(log_manager.snapshot_events().map((event) => event.message)).toEqual([
      "订阅期日志",
      "取消后日志",
    ]);
  });

  it("fatal 日志会尽力同步刷新文件输出", () => {
    const flush_calls: string[] = [];
    const log_manager = new LogManager({
      consoleWriter: () => undefined,
      fileWriter: {
        write: () => undefined,
        flushSync: () => {
          flush_calls.push("flushSync");
        },
        end: (callback?: () => void) => {
          callback?.();
        },
      },
      logDir: ".",
    });
    cleanup_callbacks.push(() => log_manager.shutdown());

    log_manager.fatal("崩溃前诊断", { targets: { console: false, window: false } });

    expect(flush_calls).toEqual(["flushSync"]);
  });

  it("shutdown 后丢弃新日志且不再写入文件或窗口事件", async () => {
    const file_lines: string[] = [];
    const stderr_write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const log_manager = create_log_manager([], LOG_WINDOW_EVENT_CAPACITY, undefined, file_lines);

    log_manager.info("关闭前日志", { targets: { console: false } });
    await log_manager.shutdown();
    log_manager.error("关闭后日志");

    expect(file_lines).toHaveLength(1);
    expect(log_manager.snapshot_events().map((event) => event.message)).toEqual(["关闭前日志"]);
    expect(stderr_write).toHaveBeenCalledWith(
      expect.stringContaining("日志系统已关闭，丢弃新日志：关闭后日志"),
    );
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
    ring_buffer_size = LOG_WINDOW_EVENT_CAPACITY,
    now?: () => Date,
    file_lines?: string[],
  ): LogManager {
    const log_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-log-test-"));
    cleanup_callbacks.push(() => fs.rmSync(log_dir, { force: true, recursive: true }));
    const log_manager = new LogManager({
      consoleWriter: (text) => {
        console_lines.push(text);
      },
      fileWriter: create_memory_file_writer(file_lines),
      logDir: log_dir,
      now,
      ringBufferSize: ring_buffer_size,
    });
    cleanup_callbacks.push(() => log_manager.shutdown());
    return log_manager;
  }

  function create_memory_file_writer(lines: string[] = []): FileLogWriter {
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
