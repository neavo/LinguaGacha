import path from "node:path";

import { describe, expect, it } from "vitest";

import { create_backend_boundary_rules } from "./backend-rules.mjs";

describe("backend API registration boundary", () => {
  it("只允许 api-gateway-server.ts 和 api-routes.ts 注册 /api 路由", () => {
    const project_root = path.resolve("test-project");
    const source_by_file = new Map([
      [
        path.join(project_root, "src/backend/api/api-gateway-server.ts"),
        'app.get("/api/health", handler);',
      ],
      [
        path.join(project_root, "src/backend/api/api-routes.ts"),
        'context.app.get("/api/events/stream", handler);',
      ],
      [
        path.join(project_root, "src/backend/api/routes/legacy-routes.ts"),
        'app.get("/api/legacy", handler);',
      ],
      [
        path.join(project_root, "src/backend/model/model-service.ts"),
        'app.delete("/api/models/delete", handler);',
      ],
    ]);
    const rule = create_backend_boundary_rules().find(
      (candidate) => candidate.name === "API 注册边界",
    );
    if (rule === undefined) {
      throw new Error("找不到 API 注册边界");
    }

    const errors = rule.check({
      files: [...source_by_file.keys()],
      project_root,
      read_file: (file_path) => source_by_file.get(file_path) ?? "",
      relative_path: (file_path) =>
        path.relative(project_root, file_path).replaceAll(path.sep, "/"),
    });

    expect(errors.map((error) => error.relative_path)).toEqual([
      "src/backend/api/routes/legacy-routes.ts",
      "src/backend/model/model-service.ts",
    ]);
  });

  it("唯一注册文件仍禁止绕过 postJson 直接注册 POST JSON 路由", () => {
    const project_root = path.resolve("test-project");
    const route_file = path.join(project_root, "src/backend/api/api-routes.ts");
    const rule = create_backend_boundary_rules().find(
      (candidate) => candidate.name === "API 注册边界",
    );
    if (rule === undefined) {
      throw new Error("找不到 API 注册边界");
    }

    const errors = rule.check({
      files: [route_file],
      project_root,
      read_file: () => 'context.app.post("/api/models/test", handler);',
      relative_path: (file_path) =>
        path.relative(project_root, file_path).replaceAll(path.sep, "/"),
    });

    expect(errors).toEqual([
      expect.objectContaining({
        relative_path: "src/backend/api/api-routes.ts",
        message: "POST JSON 路由必须通过 postJson 统一响应壳",
      }),
    ]);
  });
});
