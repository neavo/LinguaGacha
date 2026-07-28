import path from "node:path";

import { describe, expect, it } from "vitest";

import { create_backend_boundary_rules } from "./backend-rules.mjs";

const EXPECTED_RULE_NAMES = new Set([
  "API 注册边界",
  "CLI 后端依赖边界",
  "LLM 模型依赖方向",
  "NativeFs 落点边界",
  "SQLite 落点边界",
  "SSE JSON 序列化边界",
  "后端 API 依赖方向",
  "后端模块所有权",
  "模型供应商边界",
  "错误定义表边界",
]);

describe("backend boundary rules", () => {
  it("每条后端边界都能从公开规则入口报告对应违规", () => {
    const errors = run_rules({
      "src/backend/analysis/legacy.ts": "export const legacy = true;",
      "src/backend/api/api-routes.ts": 'app.post("/api/direct", handler);',
      "src/backend/api/api-stream-hub.ts": "const frame = `data: ${JSON.stringify(event)}`;",
      "src/backend/cache/store.ts": 'import "node:sqlite";',
      "src/backend/llm/client.ts": 'import "../model/model-service";',
      "src/backend/model/catalog.ts": 'import OpenAI from "openai";',
      "src/backend/quality/service.ts": [
        'import "../api/api-routes";',
        'import "node:fs/promises";',
        'app.get("/api/quality", handler);',
      ].join("\n"),
      "src/cli/main.ts": 'import "../backend/database/database-operations";',
      "src/shared/error/app-error.ts": [
        'export const APP_ERROR_DEFINITIONS = { bad: { message: "visible" } };',
        "export interface AppErrorOptions {}",
      ].join("\n"),
    });

    expect(new Set(errors.map((error) => error.rule_name))).toEqual(EXPECTED_RULE_NAMES);
    expect(errors.every((error) => error.relative_path.startsWith("src/"))).toBe(true);
  });

  it("允许各事实所有者使用自己的合法依赖和入口", () => {
    expect(
      run_rules({
        "src/backend/api/api-routes.ts": 'app.get("/api/health", handler);',
        "src/backend/database/store.ts": 'import "node:sqlite";',
        "src/backend/model/catalog.test.ts": 'import OpenAI from "openai";',
        "src/native/native-fs.ts": 'import "node:fs/promises";',
        "src/shared/error/app-error.ts": [
          'export const APP_ERROR_DEFINITIONS = { ok: { message_key: "app.error" } };',
          "export interface AppErrorOptions {}",
        ].join("\n"),
      }),
    ).toEqual([]);
  });
});

function run_rules(files) {
  const project_root = path.resolve("boundary-test-project");
  const source_by_path = new Map(
    Object.entries(files).map(([relative_path, content]) => [
      path.join(project_root, ...relative_path.split("/")),
      content,
    ]),
  );
  const context = {
    files: [...source_by_path.keys()],
    project_root,
    read_file: (file_path) => source_by_path.get(file_path) ?? "",
    relative_path: (file_path) => path.relative(project_root, file_path).replaceAll(path.sep, "/"),
  };

  return create_backend_boundary_rules().flatMap((rule) =>
    rule.check(context).map((error) => ({ rule_name: rule.name, ...error })),
  );
}
