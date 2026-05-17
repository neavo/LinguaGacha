import path from "node:path";

import { create_frontend_boundary_rules } from "./boundary-check/frontend-rules.mjs";
import { resolve_project_root, run_boundary_cli } from "./boundary-check/core.mjs";

const project_root = resolve_project_root(import.meta.url);

run_boundary_cli({
  title: "前端边界检查",
  project_root,
  roots: [path.join(project_root, "src/renderer")],
  rules: create_frontend_boundary_rules(),
});
