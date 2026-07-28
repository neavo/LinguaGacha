import { describe, expect, it } from "vitest";

import {
  create_renderer_error_report,
  normalize_renderer_error_report,
} from "./renderer-error-report";

describe("renderer error report", () => {
  it("从异常和诊断快照创建唯一公开报告形状", () => {
    const report = create_renderer_error_report({
      source: "task_snapshot",
      error: new Error("worker 爆炸"),
      diagnosticsContext: {
        route: "workbench",
        project: { projectRevision: 3 },
        task: { status: "running" },
      },
      triggeringEvent: {
        topic: "project.data_changed",
        items: { changedIds: [1] },
      },
      context: {
        stage: "handle_task_snapshot_changed",
      },
    });

    expect(report).toMatchObject({
      source: "task_snapshot",
      error: { name: "Error", message: "worker 爆炸" },
      route: "workbench",
      project: { projectRevision: 3 },
      task: { status: "running" },
      triggeringEvent: { topic: "project.data_changed" },
      context: { stage: "handle_task_snapshot_changed" },
    });
    expect(report.triggeringEvent).not.toHaveProperty("items");
  });

  it("把坏载荷收窄为稳定 fallback 报告", () => {
    expect(normalize_renderer_error_report(null)).toEqual({
      source: "renderer",
      error: { message: "unknown_renderer_error" },
    });
  });
});
