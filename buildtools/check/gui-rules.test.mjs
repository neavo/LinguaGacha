import { expect, it } from "vitest";

import { create_gui_boundary_rules } from "./gui-rules.mjs";

it("GUI 宿主拒绝 Backend 实现依赖", () => {
  const [rule] = create_gui_boundary_rules();
  const project_root = "C:\\repo";
  const file_path = `${project_root}\\src\\gui\\entry.ts`;
  const allowed_file_path = `${project_root}\\src\\gui\\bridge.ts`;
  const test_file_path = `${project_root}\\src\\gui\\entry.test.ts`;
  const errors = rule.check({
    project_root,
    files: [file_path, allowed_file_path, test_file_path],
    relative_path: (value) => value.slice(project_root.length + 1).replaceAll("\\", "/"),
    read_file: (target) =>
      target === allowed_file_path
        ? 'import { encode } from "../backend/api/api-base-url";'
        : 'import { GuiBackendBootstrap } from "../backend/bootstrap/gui-backend-bootstrap";',
  });
  expect(errors).toEqual([
    expect.objectContaining({
      relative_path: "src/gui/entry.ts",
      message: "GUI 宿主只能依赖 runtime 协议，不得导入 Backend 实现",
    }),
  ]);
});
