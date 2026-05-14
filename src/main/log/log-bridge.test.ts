import process from "node:process";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  set_electron_main_log_manager,
  write_electron_main_error,
  write_electron_main_warning,
} from "./log-bridge";

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
});
