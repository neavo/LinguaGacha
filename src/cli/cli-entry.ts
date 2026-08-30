import fs from "node:fs";
import path from "node:path";

import { build_cli_help, write_stderr, write_stdout } from "./cli-output";
import { CLIUsageError, parse_cli_args } from "./cli-parser";
import { run_cli_command } from "./cli-runner";
import type { BackendWorkerExecution } from "../backend/worker/worker-execution";

/**
 * 执行 CLI 入口并返回进程退出码；worker_execution 由产品入口显式决定 Backend worker 执行配置。
 */
export async function run_cli_entry(
  argv: string[],
  app_root: string,
  worker_execution: BackendWorkerExecution,
): Promise<number> {
  try {
    const parse_result = parse_cli_args(argv);
    if (parse_result.kind === "help") {
      write_stdout(build_cli_help(parse_result.command));
      return 0;
    }
    if (parse_result.kind === "version") {
      write_stdout(read_cli_version(app_root));
      return 0;
    }

    await run_cli_command(app_root, parse_result.command, worker_execution);
    return 0;
  } catch (error) {
    if (error instanceof CLIUsageError) {
      write_stderr(error.message);
      write_stderr(build_cli_help());
      return error.exitCode;
    }
    write_stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

/**
 * 版本优先读取发布包旁的 version.txt，开发态回退 package.json。
 */
function read_cli_version(app_root: string): string {
  const version_path = path.join(app_root, "version.txt");
  if (fs.existsSync(version_path)) {
    return fs.readFileSync(version_path, "utf-8").trim();
  }
  const package_path = path.join(process.cwd(), "package.json");
  if (fs.existsSync(package_path)) {
    const package_json = JSON.parse(fs.readFileSync(package_path, "utf-8")) as {
      version?: unknown;
    };
    return String(package_json.version ?? "0.0.0");
  }
  return "0.0.0";
}
