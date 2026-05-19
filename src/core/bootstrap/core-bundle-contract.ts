import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { EngineExecution } from "../engine/core/engine-execution";

const BUNDLED_CHUNK_DIRECTORY_NAME = "chunks"; // electron-vite 会把动态入口拆到 chunks，运行时契约需要回到 dist-electron 根目录
export const CORE_WORK_UNIT_WORKER_ENTRY_FILE_NAME = "work-unit-worker-entry.js"; // work unit worker 入口产物名必须与 Vite main input 保持一致
export const CORE_PLANNING_WORKER_ENTRY_FILE_NAME = "planning-worker-entry.js"; // planning worker 入口产物名必须与 Vite main input 保持一致

/**
 * 从当前 ESM 模块地址解析桌面 bundle 根目录；动态 chunk 内执行时必须回到父目录。
 */
export function resolve_desktop_bundle_dir_from_module_url(module_url: string): string {
  const module_dir = path.dirname(fileURLToPath(module_url));
  if (path.basename(module_dir) === BUNDLED_CHUNK_DIRECTORY_NAME) {
    return path.dirname(module_dir);
  }

  return module_dir;
}

/**
 * 构造正式任务 Engine 执行契约，调用方不再从底层池内部猜测构建产物位置。
 */
export function build_worker_threads_engine_execution_from_desktop_bundle_dir(
  desktop_bundle_dir: string,
): EngineExecution {
  return {
    kind: "worker_threads",
    workUnitWorkerEntryUrl: pathToFileURL(
      path.join(desktop_bundle_dir, CORE_WORK_UNIT_WORKER_ENTRY_FILE_NAME),
    ),
    planningWorkerEntryUrl: pathToFileURL(
      path.join(desktop_bundle_dir, CORE_PLANNING_WORKER_ENTRY_FILE_NAME),
    ),
  };
}
