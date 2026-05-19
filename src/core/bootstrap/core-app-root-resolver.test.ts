import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { NPM_INITIAL_CWD_ENV_NAME, resolve_core_app_root } from "./core-app-root-resolver";
import type { CoreLaunchEnvironment } from "./core-bootstrap-types";

let created_temp_roots: string[] = [];

afterEach(() => {
  for (const temp_root of created_temp_roots) {
    fs.rmSync(temp_root, { recursive: true, force: true });
  }
  created_temp_roots = [];
});

describe("resolve_core_app_root", () => {
  it("优先从 INIT_CWD 向上查找包含 resource 与 version.txt 的应用根", () => {
    const app_root = create_app_root();
    const nested_dir = path.join(app_root, "src", "main");
    fs.mkdirSync(nested_dir, { recursive: true });

    const result = resolve_core_app_root(
      create_environment({
        env: { [NPM_INITIAL_CWD_ENV_NAME]: nested_dir },
        appRoot: path.join(os.tmpdir(), "missing-root"),
      }),
    );

    expect(result).toBe(app_root);
  });

  it("INIT_CWD 无效时回退到 appRoot 候选", () => {
    const app_root = create_app_root();

    const result = resolve_core_app_root(
      create_environment({
        env: { [NPM_INITIAL_CWD_ENV_NAME]: path.join(os.tmpdir(), "not-found") },
        appRoot: app_root,
      }),
    );

    expect(result).toBe(app_root);
  });

  it("INIT_CWD 为空白时直接使用 appRoot 候选", () => {
    const app_root = create_app_root();

    const result = resolve_core_app_root(
      create_environment({
        env: { [NPM_INITIAL_CWD_ENV_NAME]: "   " },
        appRoot: app_root,
      }),
    );

    expect(result).toBe(app_root);
  });

  it("找不到应用根标记时返回解析后的 appRoot", () => {
    const app_root = create_temp_dir("linguagacha-root-fallback-");

    const result = resolve_core_app_root(create_environment({ appRoot: app_root }));

    expect(result).toBe(path.resolve(app_root));
  });
});

/**
 * 构造最小启动环境，测试只覆盖 appRoot 解析逻辑
 */
function create_environment(overrides: Partial<CoreLaunchEnvironment> = {}): CoreLaunchEnvironment {
  return {
    env: {},
    appRoot: process.cwd(),
    platform: "win32",
    ...overrides,
  };
}

/**
 * 创建带运行态资源标记的临时应用根
 */
function create_app_root(): string {
  const app_root = create_temp_dir("linguagacha-root-");
  fs.mkdirSync(path.join(app_root, "resource"), { recursive: true });
  fs.writeFileSync(path.join(app_root, "version.txt"), "9.8.7", "utf-8");
  return app_root;
}

function create_temp_dir(prefix: string): string {
  const temp_root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created_temp_roots.push(temp_root);
  return temp_root;
}
