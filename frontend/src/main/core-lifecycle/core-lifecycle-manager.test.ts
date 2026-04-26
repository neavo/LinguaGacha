import { describe, expect, it } from "vitest";

import { build_core_process_env, build_core_process_spawn_request } from "./core-lifecycle-manager";
import type { CoreLaunchCommand } from "./core-lifecycle-types";

describe("build_core_process_env", () => {
  it("向 Python Core 注入生命周期必要环境变量", () => {
    const env = build_core_process_env("http://127.0.0.1:3107", "token");

    expect(env["LINGUAGACHA_CORE_API_BASE_URL"]).toBe("http://127.0.0.1:3107");
    expect(env["LINGUAGACHA_CORE_INSTANCE_TOKEN"]).toBe("token");
    expect(env["PYTHONUNBUFFERED"]).toBe("1");
  });

  it("不再注入 Rich 或控制台宽度环境变量", () => {
    const env = build_core_process_env("http://127.0.0.1:3107", "token");

    expect(env["LINGUAGACHA_CORE_RICH_CONSOLE"]).toBeUndefined();
    expect(env["LINGUAGACHA_CORE_CONSOLE_WIDTH"]).toBeUndefined();
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
      "win32",
    );

    expect(request.command).toBe(launch_command.command);
    expect(request.args).toEqual(["run", "app.py"]);
    expect(request.options.cwd).toBe(launch_command.cwd);
    expect(request.options.env["LINGUAGACHA_CORE_API_BASE_URL"]).toBe(base_url);
    expect(request.options.env["LINGUAGACHA_CORE_INSTANCE_TOKEN"]).toBe(instance_token);
  });
});
