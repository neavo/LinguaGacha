import fs from "node:fs";
import path from "node:path";

import type { CoreLaunchCommand, CoreLaunchEnvironment } from "./core-lifecycle-types";

export const UV_BIN_ENV_NAME = "LINGUAGACHA_UV_BIN";
export const NPM_INITIAL_CWD_ENV_NAME = "INIT_CWD";
const CORE_EXECUTABLE_FILE_NAME = "core.exe";
const REQUIRED_SOURCE_FILES = ["app.py", "pyproject.toml"] as const;
const WINDOWS_PATH_DELIMITER = ";";

function assert_source_app_root(app_root: string): void {
  for (const required_file of REQUIRED_SOURCE_FILES) {
    const required_path = path.join(app_root, required_file);
    if (!fs.existsSync(required_path)) {
      throw new Error(`当前启动路径缺少 ${required_file}，无法回退到 uv run app.py：${app_root}`);
    }
  }
}

function build_path_extensions(environment: CoreLaunchEnvironment): string[] {
  if (environment.platform !== "win32") {
    return [""];
  }

  const raw_path_ext = environment.env["PATHEXT"];
  if (typeof raw_path_ext !== "string" || raw_path_ext.trim() === "") {
    return [".EXE", ".CMD", ".BAT", ""];
  }

  const extensions = raw_path_ext
    .split(WINDOWS_PATH_DELIMITER)
    .map((extension) => extension.trim())
    .filter((extension) => extension !== "");
  return [...extensions, ""];
}

function find_command_in_path(
  command_name: string,
  environment: CoreLaunchEnvironment,
): string | null {
  const raw_path = environment.env["PATH"] ?? "";
  const path_delimiter = environment.platform === "win32" ? WINDOWS_PATH_DELIMITER : path.delimiter;
  const search_paths = raw_path.split(path_delimiter).filter((entry) => entry !== "");
  const extensions = build_path_extensions(environment);

  for (const search_path of search_paths) {
    for (const extension of extensions) {
      const candidate_path = path.join(search_path, `${command_name}${extension}`);
      if (fs.existsSync(candidate_path)) {
        return candidate_path;
      }
    }
  }

  return null;
}

function resolve_uv_command(environment: CoreLaunchEnvironment): string {
  const overridden_uv_bin = environment.env[UV_BIN_ENV_NAME];

  if (typeof overridden_uv_bin === "string" && overridden_uv_bin.trim() !== "") {
    const uv_command = path.resolve(overridden_uv_bin.trim());
    if (!fs.existsSync(uv_command)) {
      throw new Error(`LINGUAGACHA_UV_BIN 指向的 uv 不存在：${uv_command}`);
    }
    return uv_command;
  }

  const found_uv_command = find_command_in_path("uv", environment);
  if (found_uv_command === null) {
    throw new Error("未找到 uv，请安装 uv 或通过 LINGUAGACHA_UV_BIN 指定 uv 路径。");
  }

  return found_uv_command;
}

function resolve_app_root(environment: CoreLaunchEnvironment): string {
  const initial_cwd = environment.env[NPM_INITIAL_CWD_ENV_NAME];
  if (typeof initial_cwd === "string" && initial_cwd.trim() !== "") {
    return path.resolve(initial_cwd.trim());
  }

  return path.resolve(environment.appRoot);
}

export function resolve_core_launch_command(environment: CoreLaunchEnvironment): CoreLaunchCommand {
  const app_root = resolve_app_root(environment);
  const core_executable_path = path.join(app_root, CORE_EXECUTABLE_FILE_NAME);

  if (fs.existsSync(core_executable_path)) {
    return {
      kind: "executable",
      command: core_executable_path,
      args: [],
      cwd: app_root,
    };
  }

  assert_source_app_root(app_root);
  return {
    kind: "source",
    command: resolve_uv_command(environment),
    args: ["run", "app.py"],
    cwd: app_root,
  };
}
