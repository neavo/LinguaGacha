import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  collect_files,
  find_import_specifiers,
  format_boundary_errors,
  run_boundary_rules,
} from "./core.mjs";

describe("检查工具核心", () => {
  it("递归收集文件时跳过构建产物和依赖目录", () => {
    const project_root = create_temp_project();
    try {
      write_project_file(project_root, "src/backend/index.ts", "");
      write_project_file(project_root, "build/generated.ts", "");
      write_project_file(project_root, "node_modules/pkg/index.ts", "");

      const files = collect_files([project_root]).map((file_path) => {
        return path.relative(project_root, file_path).replaceAll(path.sep, "/");
      });

      expect(files).toEqual(["src/backend/index.ts"]);
    } finally {
      rmSync(project_root, { force: true, recursive: true });
    }
  });

  it("提取静态、动态和转出 import specifier", () => {
    const specifiers = find_import_specifiers(`
      import type { Foo } from "./foo";
      import "./side-effect";
      const mod = await import("@frontend/module");
      export { Bar } from "../bar";
    `).map((entry) => entry.specifier);

    expect(specifiers).toEqual(["./foo", "./side-effect", "@frontend/module", "../bar"]);
  });

  it("执行规则并格式化带行号的错误", () => {
    const project_root = create_temp_project();
    try {
      write_project_file(project_root, "src/backend/index.ts", "bad_call();\n");

      const errors = run_boundary_rules({
        project_root,
        roots: [path.join(project_root, "src")],
        rules: [
          {
            name: "示例规则",
            check: (context) => [
              {
                line: 1,
                message: "命中坏调用",
                relative_path: context.relative_path(context.files[0]),
              },
            ],
          },
        ],
      });

      expect(format_boundary_errors("示例检查", errors)).toContain(
        "[示例规则] src/backend/index.ts:1 命中坏调用",
      );
    } finally {
      rmSync(project_root, { force: true, recursive: true });
    }
  });
});

function create_temp_project() {
  return mkdtempSync(path.join(os.tmpdir(), "linguagacha-check-core-"));
}

// 测试夹具只写入当前临时工程，避免依赖真实仓库状态。
function write_project_file(project_root, relative_path, content) {
  const file_path = path.join(project_root, relative_path);
  mkdirSync(path.dirname(file_path), { recursive: true });
  writeFileSync(file_path, content, { encoding: "utf8", flag: "w" });
}
