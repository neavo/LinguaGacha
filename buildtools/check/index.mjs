import path from "node:path";

import { create_backend_boundary_rules } from "./backend-rules.mjs";
import { create_error_contract_rules } from "./error-rules.mjs";
import { create_frontend_boundary_rules } from "./frontend-rules.mjs";
import { create_gui_boundary_rules } from "./gui-rules.mjs";
import { resolve_project_root, run_check_cli } from "./core.mjs";

const project_root = resolve_project_root(import.meta.url);

run_check_cli([
  {
    title: "错误契约检查",
    project_root,
    roots: [path.join(project_root, "src"), path.join(project_root, "buildtools")],
    rules: create_error_contract_rules(),
  },
  {
    title: "GUI 宿主边界检查",
    project_root,
    roots: [path.join(project_root, "src", "gui")],
    rules: create_gui_boundary_rules(),
  },
  {
    title: "前端边界检查",
    project_root,
    roots: [path.join(project_root, "src", "frontend")],
    rules: create_frontend_boundary_rules(),
  },
  {
    title: "后端边界检查",
    project_root,
    roots: [
      path.join(project_root, "src", "backend"),
      path.join(project_root, "src", "cli"),
      path.join(project_root, "src", "native"),
      path.join(project_root, "src", "shared", "error"),
    ],
    rules: create_backend_boundary_rules(),
  },
]);
