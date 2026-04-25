import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CORE_SOURCE_ROOT_ENV_NAME,
  UV_BIN_ENV_NAME,
  resolve_core_runtime_paths,
} from "./core-command-resolver";
import type { CoreLifecycleEnvironment } from "./core-lifecycle-types";

function create_environment(
  env: NodeJS.ProcessEnv,
  overrides: Partial<CoreLifecycleEnvironment> = {},
): CoreLifecycleEnvironment {
  return {
    appRoot: path.join("repo", "frontend"),
    env,
    isPackaged: false,
    platform: process.platform,
    resourcesPath: path.join("release", "resources"),
    ...overrides,
  };
}

describe("resolve_core_runtime_paths", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("优先使用环境变量指定的源码目录和 uv 路径", () => {
    const core_source_root = path.resolve("custom-core");
    const uv_bin = path.resolve("tools", "uv");
    vi.spyOn(fs, "existsSync").mockImplementation((candidate_path) => {
      return [
        path.join(core_source_root, "app.py"),
        path.join(core_source_root, "pyproject.toml"),
        uv_bin,
      ].includes(String(candidate_path));
    });

    const result = resolve_core_runtime_paths(
      create_environment({
        [CORE_SOURCE_ROOT_ENV_NAME]: core_source_root,
        [UV_BIN_ENV_NAME]: uv_bin,
      }),
    );

    expect(result).toEqual({
      coreSourceRoot: core_source_root,
      uvCommand: uv_bin,
    });
  });

  it("正式环境默认从 resources/core 读取源码", () => {
    const resources_path = path.resolve("release", "resources");
    const core_source_root = path.join(resources_path, "core");
    const uv_bin = path.resolve("tools", "uv");
    vi.spyOn(fs, "existsSync").mockImplementation((candidate_path) => {
      return [
        path.join(core_source_root, "app.py"),
        path.join(core_source_root, "pyproject.toml"),
        uv_bin,
      ].includes(String(candidate_path));
    });

    const result = resolve_core_runtime_paths(
      create_environment(
        {
          PATH: path.dirname(uv_bin),
          PATHEXT: "",
        },
        {
          isPackaged: true,
          resourcesPath: resources_path,
        },
      ),
    );

    expect(result.coreSourceRoot).toBe(core_source_root);
    expect(result.uvCommand).toBe(uv_bin);
  });

  it("缺少 uv 时给出清晰错误", () => {
    const app_root = path.resolve("repo", "frontend");
    const core_source_root = path.resolve(app_root, "..");
    vi.spyOn(fs, "existsSync").mockImplementation((candidate_path) => {
      return [
        path.join(core_source_root, "app.py"),
        path.join(core_source_root, "pyproject.toml"),
      ].includes(String(candidate_path));
    });

    expect(() => {
      resolve_core_runtime_paths(
        create_environment(
          {
            PATH: "",
          },
          {
            appRoot: app_root,
          },
        ),
      );
    }).toThrow("未找到 uv");
  });
});
