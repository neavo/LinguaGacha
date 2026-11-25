import { describe, expect, it } from "vitest";

import {
  summarize_project_change_for_diagnostics,
  summarize_project_state_for_diagnostics,
  summarize_task_snapshot_for_diagnostics,
} from "./desktop-diagnostics";
import { create_batch_task_snapshot } from "@domain/batch-task";
import { empty_batch_task_list_snapshot } from "@shared/batch-task";
import type { ProjectChangeEventForState } from "@frontend/app/state/desktop-project-change-types";

/**
 * 构造最小 task snapshot，验证诊断摘要不会携带 extras 大对象。
 */
function create_task_snapshot() {
  return {
    ...empty_batch_task_list_snapshot(),
    revision: 7,
    tasks: [
      {
        ...create_batch_task_snapshot("request", "request", "agent"),
        status: "running" as const,
        request_in_flight_count: 2,
      },
    ],
  };
}

/**
 * 构造项目变更事件，验证诊断只保留事件头和操作数量。
 */
function create_project_change(): ProjectChangeEventForState {
  return {
    projectId: "fixture",
    eventId: "evt-1",
    source: "write",
    projectPath: "E:/secret/project/demo.lg",
    projectRevision: 12,
    updatedSections: ["items"],
    sectionRevisions: { items: 9 },
    items: { mode: "delta", changedIds: [1, 2] },
    qualityStatisticsScope: "all",
  };
}

describe("desktop state diagnostics", () => {
  it("把项目、任务和事件压缩成轻量诊断摘要", () => {
    expect(
      summarize_project_state_for_diagnostics({
        loaded: true,
        path: "E:/secret/project/demo.lg",
        sessionStatus: "ready",
      }),
    ).toMatchObject({
      loaded: true,
      path: {
        basename: "demo.lg",
        pathHash: expect.any(String),
        length: 25,
      },
      sessionStatus: "ready",
    });

    expect(summarize_task_snapshot_for_diagnostics(create_task_snapshot())).toEqual({
      runRevision: 7,
      status: "running",
      requestInFlightCount: 2,
    });

    expect(summarize_project_change_for_diagnostics(create_project_change())).toMatchObject({
      eventId: "evt-1",
      source: "write",
      projectPath: {
        basename: "demo.lg",
        pathHash: expect.any(String),
        length: 25,
      },
      projectRevision: 12,
      updatedSections: ["items"],
      sectionRevisions: { items: 9 },
      qualityStatisticsScope: "all",
    });
  });
});
