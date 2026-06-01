import fs from "node:fs";
import path from "node:path";

import {
  build_worker_threads_backend_worker_execution_from_desktop_bundle_dir,
  resolve_desktop_bundle_dir_from_module_url,
} from "./backend/worker/worker-execution";

/**
 * 统一产品入口只负责 GUI/CLI 分发，不直接持有任何业务服务。
 */
void run_product_entry();

/**
 * 根据显式 --cli 标记选择入口适配器。
 */
async function run_product_entry(): Promise<void> {
  const desktop_bundle_dir = resolve_desktop_bundle_dir_from_module_url(import.meta.url); // 产品入口所在的构建根目录。
  const worker_execution =
    build_worker_threads_backend_worker_execution_from_desktop_bundle_dir(desktop_bundle_dir); // worker_execution 把 worker_threads 入口契约注入后续启动链路。
  if (should_run_cli()) {
    const { run_cli_entry } = await import("./cli/cli-entry");
    return exit_cli_process(
      await run_cli_entry(resolve_cli_argv(), resolve_app_root(), worker_execution),
    );
  }

  const { run_gui_entry } = await import("./gui/gui-entry");
  run_gui_entry({ desktopBundleDir: desktop_bundle_dir, workerExecution: worker_execution });
}

/**
 * 发布态和开发态统一只用 --cli 触发 CLI，平台启动器不把文件名语义泄漏进产品入口。
 */
function should_run_cli(): boolean {
  return process.argv.includes("--cli");
}

/**
 * 从 --cli 之后开始读取用户参数；Windows 轻量 cli.exe 也会先转发成 app.exe --cli。
 */
function resolve_cli_argv(): string[] {
  const cli_marker_index = process.argv.indexOf("--cli");
  if (cli_marker_index < 0) {
    throw new Error("Missing CLI entry marker --cli");
  }
  return process.argv.slice(cli_marker_index + 1);
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
