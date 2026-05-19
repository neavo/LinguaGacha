import { CoreBootstrap } from "../core/bootstrap/core-bootstrap";
import { run_cli_job } from "./job/cli-job-runner";
import type { CLICommandOptions } from "./cli-parser";
import type { WorkerPoolExecution } from "../core/engine/worker/worker-execution";
import { CLIJsonStatusReporter } from "./cli-status-reporter";
import { write_stdout } from "./cli-output";

/**
 * 在无 GUI Gateway 的 CoreBootstrap 中执行 CLI 命令，并沿入口契约下传 worker_execution。
 */
export async function run_cli_command(
  app_root: string,
  command: CLICommandOptions,
  worker_execution: WorkerPoolExecution,
): Promise<void> {
  const bootstrap = new CoreBootstrap({
    appRoot: app_root,
    exposeApiGateway: false,
    logTargets: { console: false, window: false },
    openOutputFolder: async () => undefined,
    workerExecution: worker_execution,
  });
  try {
    const start_result = await bootstrap.start();
    await run_cli_job(start_result.coreServices, command, {
      statusReporter: new CLIJsonStatusReporter({
        command: command.command,
        writeLine: write_stdout,
      }),
    });
  } finally {
    await bootstrap.stop();
  }
}
