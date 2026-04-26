import { describe, expect, it } from "vitest";

import {
  build_core_process_env,
  build_core_process_spawn_request,
  parse_windows_console_columns,
  resolve_core_console_width,
} from "./core-lifecycle-manager";
import type { CoreLaunchCommand } from "./core-lifecycle-types";

describe("resolve_core_console_width", () => {
  it("优先使用当前终端列宽", () => {
    expect(resolve_core_console_width(188, {}, null)).toBe("188");
  });

  it("允许用户用环境变量覆盖宽度", () => {
    expect(resolve_core_console_width(188, { LINGUAGACHA_CORE_CONSOLE_WIDTH: "220" }, null)).toBe(
      "220",
    );
  });

  it("stdout 列宽不可用时读取 COLUMNS", () => {
    expect(resolve_core_console_width(undefined, { COLUMNS: "144" }, null)).toBe("144");
  });

  it("stdout 和环境列宽都不可用时使用 Windows 控制台查询结果", () => {
    expect(resolve_core_console_width(undefined, {}, "196")).toBe("196");
  });

  it("列宽全都不可用时使用宽松默认值", () => {
    expect(resolve_core_console_width(undefined, {}, null)).toBe("160");
  });
});

describe("parse_windows_console_columns", () => {
  it("解析 mode con 输出里的 Columns", () => {
    expect(parse_windows_console_columns("Status for device CON:\n    Columns:        188\n")).toBe(
      "188",
    );
  });
});

describe("build_core_process_env", () => {
  it("向 Python Core 注入 Rich 控制台宽度", () => {
    const env = build_core_process_env("http://127.0.0.1:3107", "token", "188");

    expect(env["LINGUAGACHA_CORE_CONSOLE_WIDTH"]).toBe("188");
    expect(env["COLUMNS"]).toBe("188");
  });

  it("移除 NO_COLOR，避免托管输出丢失 Rich 颜色", () => {
    const env = build_core_process_env("http://127.0.0.1:3107", "token", "188");

    expect(env["NO_COLOR"]).toBeUndefined();
  });
});

describe("build_core_process_spawn_request", () => {
  const base_url = "http://127.0.0.1:50123";
  const instance_token = "token";

  it("使用 core.exe 启动目标并注入生命周期环境变量", () => {
    const launch_command: CoreLaunchCommand = {
      kind: "executable",
      command: "E:\\Project\\LinguaGacha\\core.exe",
      args: [],
      cwd: "E:\\Project\\LinguaGacha",
    };

    const request = build_core_process_spawn_request(
      launch_command,
      base_url,
      instance_token,
      "188",
      "win32",
    );

    expect(request.command).toBe(launch_command.command);
    expect(request.args).toEqual([]);
    expect(request.options.cwd).toBe(launch_command.cwd);
    expect(request.options.detached).toBe(false);
    expect(request.options.env["LINGUAGACHA_CORE_API_BASE_URL"]).toBe(base_url);
    expect(request.options.env["LINGUAGACHA_CORE_INSTANCE_TOKEN"]).toBe(instance_token);
  });

  it("使用 uv run app.py 启动目标并复用同一套环境变量", () => {
    const launch_command: CoreLaunchCommand = {
      kind: "source",
      command: "E:\\tools\\uv.exe",
      args: ["run", "app.py"],
      cwd: "E:\\Project\\LinguaGacha",
    };

    const request = build_core_process_spawn_request(
      launch_command,
      base_url,
      instance_token,
      "188",
      "win32",
    );

    expect(request.command).toBe(launch_command.command);
    expect(request.args).toEqual(["run", "app.py"]);
    expect(request.options.cwd).toBe(launch_command.cwd);
    expect(request.options.env["LINGUAGACHA_CORE_API_BASE_URL"]).toBe(base_url);
    expect(request.options.env["LINGUAGACHA_CORE_INSTANCE_TOKEN"]).toBe(instance_token);
  });
});
