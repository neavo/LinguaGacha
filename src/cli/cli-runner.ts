import { app, session } from "electron";
import path from "node:path";

import { BackendBootstrap } from "../backend/bootstrap/backend-bootstrap";
import { run_cli_job } from "./job/cli-job-runner";
import type { CLICommandOptions } from "./cli-parser";
import type { BackendWorkerExecution } from "../backend/worker/worker-execution";
import { CLIJsonStatusReporter } from "./cli-status-reporter";
import { write_stdout } from "./cli-output";

/**
 * 在无 GUI Gateway 的 BackendBootstrap 中执行 CLI 命令，并沿入口契约下传 worker_execution。
 */
export async function run_cli_command(
  app_root: string,
  command: CLICommandOptions,
  worker_execution: BackendWorkerExecution,
): Promise<void> {
  await app.whenReady();
  const bootstrap = new BackendBootstrap({
    appRoot: app_root,
    builtinRoot: path.join(app.getAppPath(), "builtin"),
    exposeApiGateway: false,
    logTargets: { console: false, window: false },
    systemProxyResolver: {
      resolveProxy: (url) => session.defaultSession.resolveProxy(url),
    },
    openOutputFolder: async () => undefined,
    workerExecution: worker_execution,
  });
  try {
    const start_result = await bootstrap.start();
    await run_cli_job(
      start_result.backendServices,
      command,
      new CLIJsonStatusReporter({
        command: command.command,
        writeLine: write_stdout,
      }),
    );
  } catch (operation_error) {
    try {
      await bootstrap.stop();
    } catch (stop_error) {
      throw new AggregateError(
        [operation_error, stop_error],
        "CLI execution failed and Backend cleanup also failed.",
      );
    }
    throw operation_error;
  }
  await bootstrap.stop();
}
