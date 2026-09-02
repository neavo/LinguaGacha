import { app, session } from "electron";
import path from "node:path";

import { BackendResources } from "../backend/bootstrap/backend-resources";
import { BackendServices } from "../backend/bootstrap/backend-services";
import { run_cli_job } from "./job/cli-job-runner";
import type { CLICommandOptions } from "./cli-parser";
import type { BackendWorkerExecution } from "../backend/worker/worker-execution";
import { CLIJsonStatusReporter } from "./cli-status-reporter";
import { write_stdout } from "./cli-output";

/**
 * 组装不含 Agent、SSE 与 Gateway 的 CLI Backend，并沿入口契约下传 worker_execution。
 */
export async function run_cli_command(
  app_root: string,
  command: CLICommandOptions,
  worker_execution: BackendWorkerExecution,
): Promise<void> {
  await app.whenReady();
  const resources = await BackendResources.start({
    appRoot: app_root,
    builtinRoot: path.join(app.getAppPath(), "builtin"),
    logTargets: { console: false, window: false },
    systemProxyResolver: {
      resolveProxy: (url) => session.defaultSession.resolveProxy(url),
    },
  });
  let services: BackendServices | null = null;
  const failures: unknown[] = [];
  try {
    services = new BackendServices({
      paths: resources.paths,
      metadata: resources.metadata,
      appSettingService: resources.settings,
      database: resources.database,
      logManager: resources.logManager,
      publishEvent: () => undefined,
      openOutputFolder: async () => undefined,
      workerExecution: worker_execution,
    });
    await run_cli_job(
      services,
      command,
      new CLIJsonStatusReporter({
        command: command.command,
        writeLine: write_stdout,
      }),
    );
  } catch (error) {
    failures.push(error);
  }
  await collect_failure(failures, async () => await services?.dispose());
  await collect_failure(failures, async () => await resources.dispose());
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, "CLI execution or Backend cleanup failed.");
  }
}

/** CLI 收尾继续释放后续层级，并按发生顺序汇总异常。 */
async function collect_failure(
  failures: unknown[],
  operation: () => void | Promise<void>,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    failures.push(error);
  }
}
