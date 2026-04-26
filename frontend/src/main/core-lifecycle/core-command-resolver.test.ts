import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  NPM_INITIAL_CWD_ENV_NAME,
  UV_BIN_ENV_NAME,
  resolve_core_launch_command,
} from "./core-command-resolver";
import type { CoreLaunchEnvironment } from "./core-lifecycle-types";

function create_environment(
  env: NodeJS.ProcessEnv,
  overrides: Partial<CoreLaunchEnvironment> = {},
): CoreLaunchEnvironment {
  return {
    appRoot: path.resolve("repo"),
    env,
    platform: "win32",
    ...overrides,
  };
}

describe("resolve_core_launch_command", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("优先启动当前路径下的 core.exe", () => {
    const app_root = path.resolve("repo");
    const core_executable = path.join(app_root, "core.exe");
    vi.spyOn(fs, "existsSync").mockImplementation((candidate_path) => {
      return String(candidate_path) === core_executable;
    });

    const result = resolve_core_launch_command(
      create_environment(
        {
          PATH: "",
          [UV_BIN_ENV_NAME]: path.resolve("tools", "uv.exe"),
        },
        {
          appRoot: app_root,
        },
      ),
    );

    expect(result).toEqual({
      kind: "executable",
      command: core_executable,
      args: [],
      cwd: app_root,
    });
  });

  it("打包态传入 exe 所在目录时优先启动同目录 core.exe", () => {
    const executable_root = path.resolve("release", "win-unpacked");
    const core_executable = path.join(executable_root, "core.exe");
    vi.spyOn(fs, "existsSync").mockImplementation((candidate_path) => {
      return String(candidate_path) === core_executable;
    });

    const result = resolve_core_launch_command(
      create_environment(
        {
          PATH: "",
        },
        {
          appRoot: executable_root,
        },
      ),
    );

    expect(result).toEqual({
      kind: "executable",
      command: core_executable,
      args: [],
      cwd: executable_root,
    });
  });

  it("macOS 打包态从 .app 的 Contents/MacOS 启动同目录 core", () => {
    const executable_root = path.resolve("LinguaGacha.app", "Contents", "MacOS");
    const core_executable = path.join(executable_root, "core");
    vi.spyOn(fs, "existsSync").mockImplementation((candidate_path) => {
      return String(candidate_path) === core_executable;
    });

    const result = resolve_core_launch_command(
      create_environment(
        {
          PATH: "",
        },
        {
          appRoot: executable_root,
          platform: "darwin",
        },
      ),
    );

    expect(result).toEqual({
      kind: "executable",
      command: core_executable,
      args: [],
      cwd: executable_root,
    });
  });

  it("Linux AppImage 打包态优先启动应用根下的 core", () => {
    const executable_root = path.resolve("appimage-mount");
    const core_executable = path.join(executable_root, "core");
    vi.spyOn(fs, "existsSync").mockImplementation((candidate_path) => {
      return String(candidate_path) === core_executable;
    });

    const result = resolve_core_launch_command(
      create_environment(
        {
          PATH: "",
        },
        {
          appRoot: executable_root,
          platform: "linux",
        },
      ),
    );

    expect(result).toEqual({
      kind: "executable",
      command: core_executable,
      args: [],
      cwd: executable_root,
    });
  });

  it("没有 core.exe 时从当前路径回退到 uv run app.py", () => {
    const app_root = path.resolve("repo");
    const uv_bin = path.resolve("tools", "uv.exe");
    vi.spyOn(fs, "existsSync").mockImplementation((candidate_path) => {
      return [
        path.join(app_root, "app.py"),
        path.join(app_root, "pyproject.toml"),
        uv_bin,
      ].includes(String(candidate_path));
    });

    const result = resolve_core_launch_command(
      create_environment(
        {
          [UV_BIN_ENV_NAME]: uv_bin,
        },
        {
          appRoot: app_root,
        },
      ),
    );

    expect(result).toEqual({
      kind: "source",
      command: uv_bin,
      args: ["run", "app.py"],
      cwd: app_root,
    });
  });

  it("非 Windows 没有 core 时仍从当前路径回退到 uv run app.py", () => {
    const app_root = path.resolve("repo");
    const uv_bin = path.resolve("tools", "uv");
    vi.spyOn(fs, "existsSync").mockImplementation((candidate_path) => {
      return [
        path.join(app_root, "app.py"),
        path.join(app_root, "pyproject.toml"),
        uv_bin,
      ].includes(String(candidate_path));
    });

    const result = resolve_core_launch_command(
      create_environment(
        {
          [UV_BIN_ENV_NAME]: uv_bin,
        },
        {
          appRoot: app_root,
          platform: "linux",
        },
      ),
    );

    expect(result).toEqual({
      kind: "source",
      command: uv_bin,
      args: ["run", "app.py"],
      cwd: app_root,
    });
  });

  it("npm --prefix 启动时使用 INIT_CWD 修正开发态应用根", () => {
    const npm_script_cwd = path.resolve("repo", "frontend");
    const initial_cwd = path.resolve("repo");
    const uv_bin = path.resolve("tools", "uv.exe");
    vi.spyOn(fs, "existsSync").mockImplementation((candidate_path) => {
      return [
        path.join(initial_cwd, "app.py"),
        path.join(initial_cwd, "pyproject.toml"),
        uv_bin,
      ].includes(String(candidate_path));
    });

    const result = resolve_core_launch_command(
      create_environment(
        {
          [NPM_INITIAL_CWD_ENV_NAME]: initial_cwd,
          [UV_BIN_ENV_NAME]: uv_bin,
        },
        {
          appRoot: npm_script_cwd,
        },
      ),
    );

    expect(result).toEqual({
      kind: "source",
      command: uv_bin,
      args: ["run", "app.py"],
      cwd: initial_cwd,
    });
  });

  it("LINGUAGACHA_UV_BIN 只影响源码回退路径", () => {
    const app_root = path.resolve("repo");
    const uv_bin = path.resolve("tools", "uv.exe");
    vi.spyOn(fs, "existsSync").mockImplementation((candidate_path) => {
      return [
        path.join(app_root, "app.py"),
        path.join(app_root, "pyproject.toml"),
        uv_bin,
      ].includes(String(candidate_path));
    });

    const result = resolve_core_launch_command(
      create_environment({
        [UV_BIN_ENV_NAME]: uv_bin,
      }),
    );

    expect(result.kind).toBe("source");
    expect(result.command).toBe(uv_bin);
  });

  it("没有 uv 覆盖时从 PATH 查找 uv", () => {
    const app_root = path.resolve("repo");
    const tool_dir = path.resolve("tools");
    const uv_bin = path.join(tool_dir, "uv.EXE");
    vi.spyOn(fs, "existsSync").mockImplementation((candidate_path) => {
      return [
        path.join(app_root, "app.py"),
        path.join(app_root, "pyproject.toml"),
        uv_bin,
      ].includes(String(candidate_path));
    });

    const result = resolve_core_launch_command(
      create_environment({
        PATH: tool_dir,
        PATHEXT: ".EXE;.CMD",
      }),
    );

    expect(result.command).toBe(uv_bin);
  });

  it("缺少源码入口文件时给出清晰错误", () => {
    const app_root = path.resolve("repo");
    vi.spyOn(fs, "existsSync").mockImplementation((candidate_path) => {
      return String(candidate_path) === path.join(app_root, "pyproject.toml");
    });

    expect(() => {
      resolve_core_launch_command(create_environment({}, { appRoot: app_root }));
    }).toThrow("当前启动路径缺少 app.py");
  });

  it("源码回退路径缺少 uv 时给出清晰错误", () => {
    const app_root = path.resolve("repo");
    vi.spyOn(fs, "existsSync").mockImplementation((candidate_path) => {
      return [path.join(app_root, "app.py"), path.join(app_root, "pyproject.toml")].includes(
        String(candidate_path),
      );
    });

    expect(() => {
      resolve_core_launch_command(create_environment({ PATH: "" }, { appRoot: app_root }));
    }).toThrow("未找到 uv");
  });
});
