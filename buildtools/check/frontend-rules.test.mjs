import path from "node:path";

import { describe, expect, it } from "vitest";

import { create_frontend_boundary_rules } from "./frontend-rules.mjs";

describe("frontend page ownership boundary", () => {
  it("阻止 feature 反向依赖页面和页面互相借用实现", () => {
    const project_root = path.resolve("test-project");
    const source_by_file = new Map([
      [
        path.join(project_root, "src/frontend/features/demo/index.ts"),
        [
          'import "@frontend/pages/alpha-page/page";',
          'import "../../pages/beta-page/page";',
          'import "@frontend/app/state/use-desktop-state";',
        ].join("\n"),
      ],
      [
        path.join(project_root, "src/frontend/pages/alpha-page/page.ts"),
        [
          'import "@frontend/pages/alpha-page/types";',
          'import "@frontend/pages/beta-page/types";',
        ].join("\n"),
      ],
    ]);
    const rule = create_frontend_boundary_rules().find(
      (candidate) => candidate.name === "frontend page 所有权边界",
    );
    if (rule === undefined) {
      throw new Error("找不到 frontend page 所有权边界");
    }

    const errors = rule.check({
      files: [...source_by_file.keys()],
      project_root,
      read_file: (file_path) => source_by_file.get(file_path) ?? "",
      relative_path: (file_path) =>
        path.relative(project_root, file_path).replaceAll(path.sep, "/"),
    });

    expect(errors).toHaveLength(3);
    expect(errors.map((error) => error.relative_path)).toEqual([
      "src/frontend/features/demo/index.ts",
      "src/frontend/features/demo/index.ts",
      "src/frontend/pages/alpha-page/page.ts",
    ]);
  });
});
