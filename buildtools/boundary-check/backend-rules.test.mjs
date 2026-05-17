import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { run_boundary_rules } from "./core.mjs";
import { create_backend_boundary_rules } from "./backend-rules.mjs";

describe("backend boundary rules", () => {
  it("允许 API、NativeFs、SQLite 和错误定义落在权威边界", () => {
    const project_root = create_temp_project();
    try {
      write_good_backend_project(project_root);

      expect(run_backend_rules(project_root)).toEqual([]);
    } finally {
      rmSync(project_root, { force: true, recursive: true });
    }
  });

  it("拦截后端路由注册、磁盘 IO、SQLite、错误文案和 SSE 序列化越界", () => {
    const project_root = create_temp_project();
    try {
      write_good_backend_project(project_root);
      write_project_file(
        project_root,
        "src/main/service/bad-route.ts",
        "app.get('/api/bad', () => {});",
      );
      write_project_file(
        project_root,
        "src/main/service/bad-storage.ts",
        `
          import fs from "node:fs";
          import { DatabaseSync } from "node:sqlite";

          export function build_frame(event) {
            fs.readFileSync("x");
            new DatabaseSync("x");
            return \`event: bad\\ndata: \${JSON.stringify(event)}\\n\\n\`;
          }
        `,
      );
      write_project_file(
        project_root,
        "src/shared/error/app-error.ts",
        `
          export const APP_ERROR_DEFINITIONS = {
            "request.validation_failed": {
              status: 400,
              severity: "expected",
              message: "请求失败",
            },
          };

          export interface AppErrorOptions {}
        `,
      );

      const messages = run_backend_rules(project_root).map((error) => error.message);

      expect(messages).toContain("/api/* 路由只能在 api-gateway-server.ts 注册");
      expect(messages).toContain("生产代码真实磁盘 IO 必须经 src/native/platform/native-fs.ts");
      expect(messages).toContain("SQLite 连接生命周期只允许落在 database 或 migration 边界");
      expect(messages).toContain(
        "APP_ERROR_DEFINITIONS 只能保存投影策略，用户可见文案必须放在 i18n 资源",
      );
      expect(messages).toContain("公开 SSE data 必须使用 JsonTool.stringifyStrict 序列化");
    } finally {
      rmSync(project_root, { force: true, recursive: true });
    }
  });
});

function run_backend_rules(project_root) {
  return run_boundary_rules({
    project_root,
    roots: [
      path.join(project_root, "src/main"),
      path.join(project_root, "src/native"),
      path.join(project_root, "src/shared/error"),
    ],
    rules: create_backend_boundary_rules(),
  });
}

function write_good_backend_project(project_root) {
  write_project_file(
    project_root,
    "src/main/api/api-gateway-server.ts",
    `
      import { JsonTool } from "../../../shared/utils/json-tool";
      app.get("/api/health", () => {});
      app.all("*", () => {});
      function post_json(app, path_name) {
        app.post(path_name, () => {});
      }
      export function build_log_sse_frame(event) {
        return \`event: log.appended\\ndata: \${JsonTool.stringifyStrict(event)}\\n\\n\`;
      }
    `,
  );
  write_project_file(project_root, "src/native/platform/native-fs.ts", 'import fs from "node:fs";');
  write_project_file(
    project_root,
    "src/main/database/database-operations.ts",
    'import { DatabaseSync } from "node:sqlite";',
  );
  write_project_file(
    project_root,
    "src/main/migration/migration-types.ts",
    'import type { DatabaseSync } from "node:sqlite";',
  );
  write_project_file(
    project_root,
    "src/shared/error/app-error.ts",
    `
      export const APP_ERROR_DEFINITIONS = {
        "request.validation_failed": {
          status: 400,
          severity: "expected",
          action_key: "app.error.request.validation_failed.action",
        },
      };

      export interface AppErrorOptions {}
    `,
  );
}

function create_temp_project() {
  return mkdtempSync(path.join(os.tmpdir(), "linguagacha-boundary-backend-"));
}

// 每个测试工程显式写出最小权威边界，断言脚本的可观察错误集合。
function write_project_file(project_root, relative_path, content) {
  const file_path = path.join(project_root, relative_path);
  mkdirSync(path.dirname(file_path), { recursive: true });
  writeFileSync(file_path, content, "utf8");
}
