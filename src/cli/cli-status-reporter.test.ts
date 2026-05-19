import { describe, expect, it } from "vitest";

import { CliJsonStatusReporter } from "./cli-status-reporter";

describe("CliJsonStatusReporter", () => {
  it("按 started/progress/finished 输出稳定 JSONL 协议", () => {
    const lines: string[] = [];
    const reporter = new CliJsonStatusReporter({
      command: "translate",
      now: () => new Date("2026-05-19T10:00:00.000Z"),
      writeLine: (line) => lines.push(line),
    });

    reporter.emit_started();
    reporter.emit_progress({
      status: "running",
      progress: {
        total_line: 4,
        line: 2,
        processed_line: 2,
        error_line: 1,
      },
    });
    reporter.emit_finished("done");

    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual([
      {
        type: "started",
        command: "translate",
        timestamp: "2026-05-19T10:00:00.000Z",
      },
      {
        type: "progress",
        command: "translate",
        status: "running",
        timestamp: "2026-05-19T10:00:00.000Z",
        stats: {
          total: 4,
          skipped: 0,
          failed: 1,
          completed: 2,
          pending: 1,
          percent: 50,
        },
      },
      {
        type: "finished",
        command: "translate",
        status: "done",
        timestamp: "2026-05-19T10:00:00.000Z",
      },
    ]);
  });

  it("四卡片统计未变化时不重复输出 progress", () => {
    const lines: string[] = [];
    const reporter = new CliJsonStatusReporter({
      command: "analyze",
      now: () => new Date("2026-05-19T10:00:00.000Z"),
      writeLine: (line) => lines.push(line),
    });

    reporter.emit_progress({
      status: "running",
      progress: { total_line: 3, line: 1, processed_line: 1, error_line: 0 },
    });
    reporter.emit_progress({
      status: "running",
      progress: { total_line: 3, line: 1, processed_line: 1, error_line: 0 },
    });

    expect(lines).toHaveLength(1);
  });

  it("失败结束时只追加稳定错误消息", () => {
    const lines: string[] = [];
    const reporter = new CliJsonStatusReporter({
      command: "translate",
      now: () => new Date("2026-05-19T10:00:00.000Z"),
      writeLine: (line) => lines.push(line),
    });

    reporter.emit_finished("error", new Error("导出失败"));

    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual([
      {
        type: "started",
        command: "translate",
        timestamp: "2026-05-19T10:00:00.000Z",
      },
      {
        type: "finished",
        command: "translate",
        status: "error",
        timestamp: "2026-05-19T10:00:00.000Z",
        error: {
          message: "导出失败",
        },
      },
    ]);
  });
});
