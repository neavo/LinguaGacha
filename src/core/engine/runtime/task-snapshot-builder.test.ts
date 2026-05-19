import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectDatabase } from "../../database/database-operations";
import { ProjectSessionState } from "../../project/project-session-state";
import { TaskRuntimeState } from "./task-runtime-state";
import { TaskSnapshotBuilder } from "./task-snapshot-builder";

describe("TaskSnapshotBuilder", () => {
  const cleanup_callbacks: Array<() => void> = [];

  afterEach(() => {
    while (cleanup_callbacks.length > 0) {
      cleanup_callbacks.pop()?.();
    }
  });

  it("用 数据库事实和 运行态组装任务快照", async () => {
    const { database, project_path } = create_project_database();
    const session_state = new ProjectSessionState();
    session_state.mark_loaded(project_path);
    seed_project(database, project_path);
    const task_runtime_state = new TaskRuntimeState();
    task_runtime_state.begin_task("translation", { kind: "items", item_ids: [101] });
    task_runtime_state.set_request_in_flight_count("translation", 2);
    const builder = new TaskSnapshotBuilder(database, task_runtime_state, session_state);

    const translation = await builder.build_task_snapshot({ task_type: "translation" });
    const analysis = await builder.build_task_snapshot({ task_type: "analysis" });

    expect(translation).toMatchObject({
      task_type: "translation",
      status: "requested",
      busy: true,
      request_in_flight_count: 2,
      progress: {
        line: 5,
        total_line: 10,
        total_tokens: 42,
      },
      extras: {
        kind: "translation",
        scope: { kind: "items", item_ids: [101] },
      },
    });
    expect(analysis).toMatchObject({
      task_type: "analysis",
      progress: {
        line: 2,
        total_line: 2,
        processed_line: 1,
        error_line: 1,
      },
      extras: {
        kind: "analysis",
        candidate_count: 3,
      },
    });
  });

  function create_project_database(): { database: ProjectDatabase; project_path: string } {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-task-test-"));
    const project_path = path.join(directory, "task.lg");
    const database = new ProjectDatabase();
    database.execute({ name: "createProject", args: { projectPath: project_path, name: "task" } });
    cleanup_callbacks.push(() => fs.rmSync(directory, { force: true, recursive: true }));
    cleanup_callbacks.push(() => database.close());
    return { database, project_path };
  }

  function seed_project(database: ProjectDatabase, project_path: string): void {
    database.execute_transaction([
      {
        name: "setItems",
        args: {
          projectPath: project_path,
          items: [
            create_project_item({ id: 101, src: "原文", status: "NONE" }),
            create_project_item({ id: 102, src: "失败", status: "NONE" }),
            create_project_item({ id: 103, src: "跳过", status: "EXCLUDED" }),
          ],
        },
      },
      {
        name: "upsertMetaEntries",
        args: {
          projectPath: project_path,
          meta: {
            translation_extras: { line: 5, total_line: 10, total_tokens: 42 },
            analysis_extras: { total_tokens: 12 },
            analysis_candidate_count: 3,
          },
        },
      },
      {
        name: "upsertAnalysisItemCheckpoints",
        args: {
          projectPath: project_path,
          checkpoints: [
            { item_id: 101, status: "PROCESSED", updated_at: "2026-01-01", error_count: 0 },
            { item_id: 102, status: "ERROR", updated_at: "2026-01-01", error_count: 1 },
          ],
        },
      },
    ]);
  }

  function create_project_item(
    overrides: Partial<Record<string, string | number | boolean | null>>,
  ): Record<string, string | number | boolean | null> {
    const id = Number(overrides["id"] ?? 1);
    return {
      id,
      src: "",
      dst: "",
      name_src: null,
      name_dst: null,
      extra_field: "",
      tag: "",
      row: id,
      file_type: "TXT",
      file_path: "script.txt",
      text_type: "NONE",
      status: "NONE",
      retry_count: 0,
      skip_internal_filter: false,
      ...overrides,
    };
  }
});
