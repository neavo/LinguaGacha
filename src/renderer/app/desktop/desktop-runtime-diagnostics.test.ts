import { describe, expect, it } from "vitest";

import {
  summarize_project_change_for_diagnostics,
  summarize_project_change_payload_for_diagnostics,
  summarize_runtime_project_for_diagnostics,
  summarize_scheduler_error_context,
  summarize_task_snapshot_for_diagnostics,
} from "./desktop-runtime-diagnostics";
import type { TaskSnapshot } from "./task-runtime-store";
import type { ProjectRuntimeChangeEvent } from "@/app/desktop/desktop-project-change-types";

/**
 * 构造最小 task snapshot，验证诊断摘要不会携带 extras 大对象。
 */
function create_task_snapshot(): TaskSnapshot {
  return {
    runtime_revision: 7,
    task_type: "translation",
    status: "running",
    busy: true,
    request_in_flight_count: 2,
    progress: {
      line: 5,
      total_line: 20,
      processed_line: 4,
      error_line: 1,
      total_tokens: 100,
      total_output_tokens: 40,
      total_input_tokens: 60,
      time: 12,
      start_time: 3,
    },
    extras: { kind: "translation", scope: { kind: "all" } },
  };
}

/**
 * 构造项目变更事件，验证诊断只保留事件头和操作数量。
 */
function create_project_change(): ProjectRuntimeChangeEvent {
  return {
    eventId: "evt-1",
    source: "mutation",
    projectPath: "E:/secret/project/demo.lg",
    projectRevision: 12,
    updatedSections: ["items"],
    sectionRevisions: { items: 9 },
    operations: [
      {
        items: {
          payloadMode: "canonical-delta",
          changedIds: [1, 2],
          upsert: {
            "1": {
              id: 1,
              src: "原文",
            },
          },
        },
      },
    ],
  };
}

describe("desktop runtime diagnostics", () => {
  it("把项目、任务和事件压缩成轻量诊断摘要", () => {
    expect(
      summarize_runtime_project_for_diagnostics({
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
      runtimeRevision: 7,
      taskType: "translation",
      status: "running",
      busy: true,
      requestInFlightCount: 2,
      progress: {
        line: 5,
        totalLine: 20,
        processedLine: 4,
        errorLine: 1,
      },
    });

    expect(summarize_project_change_for_diagnostics(create_project_change())).toMatchObject({
      eventId: "evt-1",
      source: "mutation",
      projectPath: {
        basename: "demo.lg",
        pathHash: expect.any(String),
        length: 25,
      },
      projectRevision: 12,
      updatedSections: ["items"],
      sectionRevisions: { items: 9 },
      operationCount: 1,
    });
  });

  it("异常恢复上下文只保留可定位批次形状", () => {
    expect(
      summarize_project_change_payload_for_diagnostics({
        eventId: "evt-2",
        source: "sse",
        projectPath: "E:/secret/project/demo.lg",
        projectRevision: 13,
        updatedSections: ["items", "bad"],
        sectionRevisions: { items: 10 },
      }),
    ).toMatchObject({
      eventId: "evt-2",
      source: "sse",
      updatedSections: ["items", "bad"],
      sectionRevisions: { items: 10 },
    });

    expect(
      summarize_scheduler_error_context({
        phase: "project_change_batch",
        projectChanges: [create_project_change()],
        taskSnapshot: create_task_snapshot(),
      }),
    ).toMatchObject({
      phase: "project_change_batch",
      projectChanges: [
        {
          eventId: "evt-1",
          operationCount: 1,
        },
      ],
      taskSnapshot: {
        runtimeRevision: 7,
        progress: {
          line: 5,
        },
      },
    });
  });
});
