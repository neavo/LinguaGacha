import { describe, expect, it } from "vitest";

import type { CLICommandName } from "./cli-parser";
import { CLIJsonStatusReporter, build_cli_progress_stats } from "./cli-status-reporter";

const TIMESTAMP = "2026-05-19T10:00:00.000Z";

describe("CLIJsonStatusReporter", () => {
  it("输出唯一的 started/progress/finished JSONL 生命周期", () => {
    const { events, reporter } = create_reporter("translate");

    reporter.emit_started();
    reporter.emit_started();
    reporter.emit_progress({ status: "running", progress: {} });
    reporter.emit_progress({
      status: "running",
      progress: { total_line: 100, processed_line: 90 },
      run_progress: { total_line: 4, processed_line: 2, failed_line: 1 },
    });
    reporter.emit_progress({
      status: "stopping",
      progress: { total_line: 100, processed_line: 90 },
      run_progress: { total_line: 4, processed_line: 2, failed_line: 1 },
    });
    reporter.emit_finished("done");
    reporter.emit_finished("done");

    expect(events).toEqual([
      { type: "started", command: "translate", timestamp: TIMESTAMP },
      {
        type: "progress",
        command: "translate",
        status: "running",
        timestamp: TIMESTAMP,
        stats: {
          total: 4,
          skipped: 0,
          failed: 1,
          completed: 2,
          pending: 1,
          percent: 50,
        },
      },
      { type: "finished", command: "translate", status: "done", timestamp: TIMESTAMP },
    ]);
  });

  it("累计进度不从旧字段恢复成功数或失败数", () => {
    expect(
      build_cli_progress_stats({ total_line: 4, processed_line: 0, line: 3, error_line: 2 }),
    ).toMatchObject({ completed: 0, failed: 0, pending: 4 });
  });

  it("失败结束时自动补 started 并只暴露错误消息", () => {
    const { events, reporter } = create_reporter("translate");

    reporter.emit_finished("error", new Error("导出失败"));

    expect(events).toEqual([
      { type: "started", command: "translate", timestamp: TIMESTAMP },
      {
        type: "finished",
        command: "translate",
        status: "error",
        timestamp: TIMESTAMP,
        error: { message: "导出失败" },
      },
    ]);
  });
});

/** 固定时钟并解析实际 JSONL 输出，观察调用方收到的事件。 */
function create_reporter(command: CLICommandName): {
  events: Array<Record<string, unknown>>;
  reporter: CLIJsonStatusReporter;
} {
  const events: Array<Record<string, unknown>> = [];
  return {
    events,
    reporter: new CLIJsonStatusReporter({
      command,
      now: () => new Date(TIMESTAMP),
      writeLine: (line) => events.push(JSON.parse(line) as Record<string, unknown>),
    }),
  };
}
