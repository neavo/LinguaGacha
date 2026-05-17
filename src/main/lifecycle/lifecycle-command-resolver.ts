import path from "node:path";

import { default_native_fs } from "../../native/platform/native-fs";
import type { CoreLaunchEnvironment } from "./lifecycle-types";

export const NPM_INITIAL_CWD_ENV_NAME = "INIT_CWD";
const APP_ROOT_MARKER_FILES = ["version.txt"] as const;
const APP_ROOT_MARKER_DIRS = ["resource"] as const;

function is_app_root(app_root: string): boolean {
  const has_files = APP_ROOT_MARKER_FILES.every((required_file) => {
    return default_native_fs.exists(path.join(app_root, required_file));
  });
  const has_dirs = APP_ROOT_MARKER_DIRS.every((required_dir) => {
    return default_native_fs.exists(path.join(app_root, required_dir));
  });
  return has_files && has_dirs;
}

function find_app_root_from_candidate(candidate_root: string): string | null {
  let current_root = path.resolve(candidate_root);

  while (true) {
    if (is_app_root(current_root)) {
      return current_root;
    }

    const parent_root = path.dirname(current_root);
    if (parent_root === current_root) {
      return null;
    }
    current_root = parent_root;
  }
}

/**
 * 解析应用根目录；运行态只需要找到 resource 与 version.txt，不再解析后端进程入口
 */
export function resolve_core_app_root(environment: CoreLaunchEnvironment): string {
  const initial_cwd = environment.env[NPM_INITIAL_CWD_ENV_NAME];
  const candidate_roots: string[] = [];

  if (typeof initial_cwd === "string" && initial_cwd.trim() !== "") {
    candidate_roots.push(initial_cwd.trim());
  }
  candidate_roots.push(environment.appRoot);

  for (const candidate_root of candidate_roots) {
    const app_root = find_app_root_from_candidate(candidate_root);
    if (app_root !== null) {
      return app_root;
    }
  }

  return path.resolve(environment.appRoot);
}
