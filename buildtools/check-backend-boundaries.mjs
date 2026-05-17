import path from "node:path";

import { create_backend_boundary_rules } from "./boundary-check/backend-rules.mjs";
import { resolve_project_root, run_boundary_cli } from "./boundary-check/core.mjs";

const project_root = resolve_project_root(import.meta.url);

run_boundary_cli({
  title: "后端边界检查",
  project_root,
  roots: [
    path.join(project_root, "src/main"),
    path.join(project_root, "src/native"),
    path.join(project_root, "src/shared/error"),
  ],
  rules: create_backend_boundary_rules(),
});
