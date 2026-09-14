import path from "node:path";

import { expect, it } from "vitest";

import { create_check_context } from "./core.mjs";
import { create_gui_boundary_rules } from "./gui-rules.mjs";
import { create_source_reader } from "./source-reader.mjs";

it("GUI 宿主拒绝 Backend 实现依赖", () => {
  const [rule] = create_gui_boundary_rules();
  const project_root = path.resolve("gui-test-project");
  const file_path = path.join(project_root, "src/gui/entry.ts");
  const allowed_file_path = path.join(project_root, "src/gui/bridge.ts");
  const test_file_path = path.join(project_root, "src/gui/entry.test.ts");
  const errors = rule.check(
    create_check_context({
      project_root,
      files: [file_path, allowed_file_path, test_file_path],
      source_reader: create_source_reader((target) =>
        target === allowed_file_path
          ? 'import { encode } from "../backend/api/api-base-url";'
          : 'import { GuiBackendBootstrap } from "../backend/bootstrap/gui-backend-bootstrap";',
      ),
    }),
  );
  expect(errors).toEqual([
    expect.objectContaining({
      relative_path: "src/gui/entry.ts",
      line: 1,
    }),
  ]);
});
