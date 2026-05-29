import process from "node:process";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  set_electron_main_log_manager,
  write_electron_main_error,
  write_electron_main_warning,
} from "./log-bridge";
import { LogManager, type FileLogWriter } from "./log-manager";

describe("log-bridge", () => {
  const time_prefix = "\x1b[2m\x1b[36m[12:12:12]\x1b[39m\x1b[22m";

  beforeEach(() => {
    set_electron_main_log_manager(null);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2012, 11, 12, 12, 12, 12));
  });

  afterEach(() => {
    set_electron_main_log_manager(null);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("没有 LogManager 时 warning 仍使用主路径控制台格式", () => {
    const stdout_write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr_write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    write_electron_main_warning("启动早期警告");

    expect(stdout_write).toHaveBeenCalledWith(
      `${time_prefix}  \x1b[33mWARNING\x1b[39m  启动早期警告\n`,
    );
    expect(stderr_write).not.toHaveBeenCalled();
  });

  it("没有 LogManager 时 error 仍使用主路径控制台格式", () => {
    const stdout_write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr_write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    write_electron_main_error("启动早期错误", { error: "boom" });

    expect(stderr_write).toHaveBeenCalledWith(
      `${time_prefix}  \x1b[31mERROR  \x1b[39m  启动早期错误\n                     boom\n`,
    );
    expect(stdout_write).not.toHaveBeenCalled();
  });

  it("有 LogManager 时写入同一日志权威并保留 Electron 上下文", async () => {
    const file_lines: string[] = [];
    const console_lines: string[] = [];
    const log_manager = new LogManager({
      consoleWriter: (text) => {
        console_lines.push(text);
      },
      fileWriter: create_memory_file_writer(file_lines),
      logDir: ".",
      now: () => new Date(2012, 11, 12, 12, 12, 12),
    });
    set_electron_main_log_manager(log_manager);

    write_electron_main_error("主进程异常", {
      error: new Error("provider boom"),
      context: { phase: "ready" },
    });
    await log_manager.shutdown();

    const file_record = JSON.parse(file_lines[0] ?? "{}") as Record<string, unknown>;
    expect(file_record["message"]).toBe("主进程异常");
    expect(file_record["source"]).toBe("electron-main");
    expect(file_record["error"]).toMatchObject({
      name: "Error",
      message: "provider boom",
      context: { phase: "ready" },
    });
    expect(JSON.stringify(file_record["error"])).toContain("provider boom");
    expect(console_lines[0]).toContain("主进程异常");
    expect(log_manager.snapshot_events()).toMatchObject([
      {
        level: "error",
        message_preview: "主进程异常",
      },
    ]);
  });

  it("保留 renderer 加载失败的 Electron 原生诊断字段", async () => {
    const file_lines: string[] = [];
    const log_manager = new LogManager({
      consoleWriter: () => undefined,
      fileWriter: create_memory_file_writer(file_lines),
      logDir: ".",
      now: () => new Date(2012, 11, 12, 12, 12, 12),
    });
    set_electron_main_log_manager(log_manager);

    write_electron_main_error("渲染层入口加载失败", {
      context: {
        error_code: -105,
        error_description: "NAME_NOT_RESOLVED",
        validated_url: "http://127.0.0.1:5173/",
      },
    });
    await log_manager.shutdown();

    const file_record = JSON.parse(file_lines[0] ?? "{}") as Record<string, unknown>;
    expect(file_record["context"]).toEqual({
      error_code: -105,
      error_description: "NAME_NOT_RESOLVED",
      validated_url: "http://127.0.0.1:5173/",
    });
  });

  // create_memory_file_writer 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
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
