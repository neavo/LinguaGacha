import { app, session } from "electron";

import { CoreBootstrap } from "../core/bootstrap/core-bootstrap";
import { run_cli_job } from "./job/cli-job-runner";
import type { CLICommandOptions } from "./cli-parser";
import type { CoreWorkerExecution } from "../core/worker/worker-execution";
import type { CoreBootstrapStartResult } from "../core/bootstrap/core-bootstrap-types";
import { CLIJsonStatusReporter } from "./cli-status-reporter";
import { create_text_resolver, resolve_i18n_locale } from "../shared/i18n";
import { write_stderr, write_stdout } from "./cli-output";

/**
 * 在无 GUI Gateway 的 CoreBootstrap 中执行 CLI 命令，并沿入口契约下传 worker_execution。
 */
export async function run_cli_command(
  app_root: string,
  command: CLICommandOptions,
  worker_execution: CoreWorkerExecution,
): Promise<void> {
  await app.whenReady();
  const bootstrap = new CoreBootstrap({
    appRoot: app_root,
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
    write_system_proxy_startup_notice(start_result);
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

/**
 * CLI 的人类可读启动提示只写 stderr，避免污染 stdout 的 JSONL 状态协议。
 */
function write_system_proxy_startup_notice(start_result: CoreBootstrapStartResult): void {
  if (!start_result.systemProxyStartupNotice.detected) {
    return;
  }

  const t = create_text_resolver(resolve_i18n_locale(start_result.readAppLanguage()));
  write_stderr(
    t("app.system_proxy.startup_notice", {
      PROXY: start_result.systemProxyStartupNotice.proxyDisplay ?? "",
    }),
  );
}
