import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { WorkerPoolExecution } from "../engine/worker/worker-execution";

const BUNDLED_CHUNK_DIRECTORY_NAME = "chunks"; // electron-vite 会把动态入口拆到 chunks，运行时契约需要回到 dist-electron 根目录
export const CORE_WORKER_ENTRY_FILE_NAME = "worker-entry.js"; // worker 入口产物名必须与 Vite main input 保持一致

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
 * 构造正式任务 worker 执行契约，调用方不再从 WorkerPool 内部猜测构建产物位置。
 */
export function build_worker_threads_execution_from_desktop_bundle_dir(
  desktop_bundle_dir: string,
): WorkerPoolExecution {
  return {
    kind: "worker_threads",
    workerEntryUrl: pathToFileURL(path.join(desktop_bundle_dir, CORE_WORKER_ENTRY_FILE_NAME)),
  };
}
