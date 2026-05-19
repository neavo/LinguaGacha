import type { CliJsonStatusReporter } from "../cli-status-reporter";

export interface CliJobRunOptions {
  statusReporter: CliJsonStatusReporter; // statusReporter 是 CLI JSONL 生命周期事件的唯一输出口
}
