import type { CLIJsonStatusReporter } from "../cli-status-reporter";

export interface CLIJobRunOptions {
  statusReporter: CLIJsonStatusReporter; // CLI JSONL 生命周期事件的唯一输出口
}
