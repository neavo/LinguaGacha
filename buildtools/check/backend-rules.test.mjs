import path from "node:path";

import { describe, expect, it } from "vitest";

import { create_check_context } from "./core.mjs";
import { create_source_reader } from "./source-reader.mjs";
import { create_backend_boundary_rules } from "./backend-rules.mjs";

describe("backend boundary rules", () => {
  it("每条后端边界都能从公开规则入口报告对应违规", () => {
    const errors = run_rules({
      "src/backend/analysis/legacy.ts": "export const legacy = true;",
      "src/backend/api/api-routes.ts": 'app.post("/api/direct", handler);',
      "src/backend/api/api-stream-hub.ts": "const frame = `data: ${JSON.stringify(event)}`;",
      "src/backend/cache/store.ts": 'import "node:sqlite";',
      "src/backend/bootstrap/backend-services.ts": 'import "../agent/agent-service";',
      "src/backend/llm/client.ts": 'import "../model/model-service";',
      "src/backend/model/catalog.ts": 'import OpenAI from "openai";',
      "src/backend/model/network.ts": [
        'import { fetch } from "undici";',
        "globalThis.fetch = custom_fetch;",
      ].join("\n"),
      "src/backend/quality/service.ts": [
        'import "../api/api-routes";',
        'import "node:fs/promises";',
        'app.get("/api/quality", handler);',
      ].join("\n"),
      "src/cli/main.ts": 'import "../backend/agent/agent-service";',
      "src/shared/error/app-error.ts": [
        'export const APP_ERROR_DEFINITIONS = { bad: { message: "visible" } };',
        "export interface AppErrorOptions {}",
      ].join("\n"),
    });

    expect(
      errors.map(({ relative_path, line }) => `${relative_path}:${line ?? "-"}`).sort(),
    ).toEqual(
      [
        "src/backend/analysis/legacy.ts:-",
        "src/backend/api/api-routes.ts:1",
        "src/backend/api/api-stream-hub.ts:1",
        "src/backend/cache/store.ts:1",
        "src/backend/bootstrap/backend-services.ts:1",
        "src/backend/llm/client.ts:1",
        "src/backend/model/catalog.ts:1",
        "src/backend/model/network.ts:1",
        "src/backend/model/network.ts:2",
        "src/backend/quality/service.ts:1",
        "src/backend/quality/service.ts:2",
        "src/backend/quality/service.ts:3",
        "src/cli/main.ts:-",
        "src/shared/error/app-error.ts:1",
      ].sort(),
    );
  });

  it("允许各事实所有者使用自己的合法依赖和入口", () => {
    expect(
      run_rules({
        "src/backend/api/api-routes.ts": 'app.get("/api/health", handler);',
        "src/backend/database/store.ts": 'import "node:sqlite";',
        "src/backend/model/catalog.test.ts": 'import OpenAI from "openai";',
        "src/backend/network/system-proxy-http-client.ts": [
          'import { fetch as undici_fetch } from "undici";',
          'undici_fetch("https://example.com");',
        ].join("\n"),
        "src/native/native-fs.ts": 'import "node:fs/promises";',
        "src/backend/agent/workspace/runtime/entry.ts": 'import "node:fs/promises";',
        "src/shared/error/app-error.ts": [
          'export const APP_ERROR_DEFINITIONS = { ok: { status: 400, severity: "expected" } };',
          "export interface AppErrorOptions {}",
        ].join("\n"),
      }),
    ).toEqual([]);
  });

  it("允许普通 fetch 但禁止 Backend Runtime 与 CLI 替换 transport", () => {
    expect(
      run_rules({
        "src/backend/model/catalog.ts": 'fetch("https://example.com");',
      }),
    ).toEqual([]);
    expect(
      run_rules({
        "src/cli/main.ts": "globalThis.fetch = custom_fetch;",
      }),
    ).toEqual([
      expect.objectContaining({
        relative_path: "src/cli/main.ts",
      }),
    ]);
  });

  it("拒绝 CLI 经中间服务传递依赖 Agent 或 API", () => {
    const errors = run_rules({
      "src/backend/feature/service.ts": 'import "../agent/agent-service";',
      "src/cli/main.ts": 'import "../backend/feature/service";',
    });

    expect(errors).toContainEqual(
      expect.objectContaining({
        relative_path: "src/cli/main.ts",
      }),
    );
  });
});

/** 用内存源码执行真实规则，避免测试依赖当前工作区内容。 */
function run_rules(files) {
  const project_root = path.resolve("boundary-test-project");
  const source_by_path = new Map(
    Object.entries(files).map(([relative_path, content]) => [
      path.join(project_root, ...relative_path.split("/")),
      content,
    ]),
  );
  const context = create_check_context({
    files: [...source_by_path.keys()],
    project_root,
    source_reader: create_source_reader((file_path) => source_by_path.get(file_path)),
  });

  return create_backend_boundary_rules().flatMap((rule) => rule.check(context));
}
