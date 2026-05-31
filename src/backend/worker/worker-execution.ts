import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const BUNDLED_CHUNK_DIRECTORY_NAME = "chunks"; // electron-vite 会把动态入口拆到 chunks，运行时契约需要回到 dist-electron 根目录
const WORK_UNIT_WORKER_ENTRY_FILE_NAME = "work-unit-worker-entry.js"; // work unit worker 入口产物名必须与 Vite main input 保持一致
const PLANNING_WORKER_ENTRY_FILE_NAME = "planning-worker-entry.js"; // planning worker 入口产物名必须与 Vite main input 保持一致
const BACKEND_WORKER_ENTRY_FILE_NAME = "backend-worker-entry.js"; // 非 engine Backend worker 入口产物名必须与 Vite main input 保持一致

// 由产品入口显式注入，避免运行时在底层自行猜测构建产物位置或执行模式。
export type BackendWorkerExecution =
  | {
      kind: "worker_threads"; // worker_threads 是 GUI / CLI 正式 worker 执行路径
      workUnitWorkerEntryUrl: URL; // 指向构建产物中的 work unit worker 入口文件
      planningWorkerEntryUrl: URL; // 指向构建产物中的 planning worker 入口文件
      backendWorkerEntryUrl: URL; // 指向非 engine 通用 worker 入口文件
    }
  | {
      // in_process 是测试和源码执行显式选择的同进程模式：不读取构建产物，不作为生产回退或兼容层。
      kind: "in_process";
    };

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
 * 构造正式 Backend worker 执行配置，调用方不再从底层池内部猜测构建产物位置。
 */
export function build_worker_threads_backend_worker_execution_from_desktop_bundle_dir(
  desktop_bundle_dir: string,
): BackendWorkerExecution {
  return {
    kind: "worker_threads",
    workUnitWorkerEntryUrl: pathToFileURL(
      path.join(desktop_bundle_dir, WORK_UNIT_WORKER_ENTRY_FILE_NAME),
    ),
    planningWorkerEntryUrl: pathToFileURL(
      path.join(desktop_bundle_dir, PLANNING_WORKER_ENTRY_FILE_NAME),
    ),
    backendWorkerEntryUrl: pathToFileURL(
      path.join(desktop_bundle_dir, BACKEND_WORKER_ENTRY_FILE_NAME),
    ),
  };
}
