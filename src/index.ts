import fs from "node:fs";
import path from "node:path";

import {
  build_worker_threads_backend_worker_execution_from_desktop_bundle_dir,
  build_backend_runtime_worker_entry_url_from_desktop_bundle_dir,
  resolve_desktop_bundle_dir_from_module_url,
} from "./backend/worker/worker-execution";

/**
 * 统一产品入口配置 worker 执行路径，再分发 GUI/CLI。
 */
void run_product_entry();

/**
 * 根据显式 --cli 标记选择入口适配器。
 */
async function run_product_entry(): Promise<void> {
  const desktop_bundle_dir = resolve_desktop_bundle_dir_from_module_url(import.meta.url); // 产品入口所在的构建根目录。
  const worker_execution =
    build_worker_threads_backend_worker_execution_from_desktop_bundle_dir(desktop_bundle_dir); // worker_execution 把 worker_threads 入口契约注入后续启动链路。
  const cli_marker_index = process.argv.indexOf("--cli"); // 分发与参数截取共用同一个 CLI 标记位置。
  if (cli_marker_index >= 0) {
    const { run_cli_entry } = await import("./cli/cli-entry");
    return exit_cli_process(
      await run_cli_entry(
        process.argv.slice(cli_marker_index + 1),
        resolve_app_root(),
        worker_execution,
      ),
    );
  }

  const { run_gui_entry } = await import("./gui/gui-entry");
  run_gui_entry({
    desktopBundleDir: desktop_bundle_dir,
    backendRuntimeWorkerEntryUrl:
      build_backend_runtime_worker_entry_url_from_desktop_bundle_dir(desktop_bundle_dir),
  });
}

/**
 * appRoot 优先取可执行文件旁的发布目录，开发态回退当前工作区。
 */
function resolve_app_root(): string {
  const executable_dir = path.dirname(process.execPath);
  if (fs.existsSync(path.join(executable_dir, "version.txt"))) {
    return executable_dir;
  }
  return process.cwd();
}

/**
 * CLI 命令完成后必须主动终止 Electron 进程，否则 Windows 启动器会一直等待子进程。
 */
function exit_cli_process(exit_code: number): never {
  process.exit(exit_code);
}
