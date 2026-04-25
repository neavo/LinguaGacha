import fs from "node:fs";
import path from "node:path";

import type { CoreLifecycleEnvironment, CoreRuntimePaths } from "./core-lifecycle-types";

export const CORE_SOURCE_ROOT_ENV_NAME = "LINGUAGACHA_CORE_SOURCE_ROOT";
export const UV_BIN_ENV_NAME = "LINGUAGACHA_UV_BIN";
const CORE_RESOURCE_DIRECTORY_NAME = "core";
const REQUIRED_CORE_FILES = ["app.py", "pyproject.toml"] as const;

function assert_core_source_root(core_source_root: string): void {
  for (const required_file of REQUIRED_CORE_FILES) {
    const required_path = path.join(core_source_root, required_file);
    if (!fs.existsSync(required_path)) {
      throw new Error(`Python Core 源码目录缺少 ${required_file}：${core_source_root}`);
    }
  }
}

function resolve_core_source_root(environment: CoreLifecycleEnvironment): string {
  const overridden_source_root = environment.env[CORE_SOURCE_ROOT_ENV_NAME];

  if (typeof overridden_source_root === "string" && overridden_source_root.trim() !== "") {
    const core_source_root = path.resolve(overridden_source_root.trim());
    assert_core_source_root(core_source_root);
    return core_source_root;
  }

  const core_source_root = environment.isPackaged
    ? path.join(environment.resourcesPath, CORE_RESOURCE_DIRECTORY_NAME)
    : path.resolve(environment.appRoot, "..");
  assert_core_source_root(core_source_root);
  return core_source_root;
}

function build_path_extensions(environment: CoreLifecycleEnvironment): string[] {
  if (environment.platform !== "win32") {
    return [""];
  }

  const raw_path_ext = environment.env["PATHEXT"];
  if (typeof raw_path_ext !== "string" || raw_path_ext.trim() === "") {
    return [".EXE", ".CMD", ".BAT", ""];
  }

  const extensions = raw_path_ext
    .split(path.delimiter)
    .map((extension) => extension.trim())
    .filter((extension) => extension !== "");
  return [...extensions, ""];
}

function find_command_in_path(
  command_name: string,
  environment: CoreLifecycleEnvironment,
): string | null {
  const raw_path = environment.env["PATH"] ?? "";
  const search_paths = raw_path.split(path.delimiter).filter((entry) => entry !== "");
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

function resolve_uv_command(environment: CoreLifecycleEnvironment): string {
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

export function resolve_core_runtime_paths(
  environment: CoreLifecycleEnvironment,
): CoreRuntimePaths {
  return {
    coreSourceRoot: resolve_core_source_root(environment),
    uvCommand: resolve_uv_command(environment),
  };
}
