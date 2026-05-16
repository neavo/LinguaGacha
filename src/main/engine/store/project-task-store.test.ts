import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiJsonValue } from "../../api/api-types";
import { ProjectDatabase } from "../../database/database-operations";
import type { ProjectChangePublisher } from "../../project/project-change-publisher";
import { ProjectSessionState } from "../../project/project-session-state";
import { TaskRuntimeState } from "../runtime/task-runtime-state";
import type { MutableJsonRecord } from "../runtime/task-runtime-types";
import { ProjectTaskStore } from "./project-task-store";

describe("ProjectTaskStore", () => {
  const cleanup_callbacks: Array<() => void> = [];

  afterEach(() => {
    vi.useRealTimers();
    while (cleanup_callbacks.length > 0) {
      cleanup_callbacks.pop()?.();
    }
  });

  it("提交翻译 artifact 时写入 items、进度 meta 并发布行级 items 变更", () => {
    const { database, project_path, store, published_changes } = create_store();
    seed_items(database, project_path);

    const ack = store.commit_artifacts({
      task_type: "translation",
      artifacts: [
        {
          kind: "item_updates",
          source: "translation",
          items: [
            {
              id: 1,
              src: "原文",
              dst: "译文",
              status: "PROCESSED",
              file_path: "demo.txt",
            },
          ],
          affects_proofreading: false,
        },
      ],
      progress_snapshot: create_progress_snapshot({ line: 1, processed_line: 1 }),
    });

    expect(read_items(database, project_path)).toEqual([
      { id: 1, src: "原文", dst: "译文", status: "PROCESSED", file_path: "demo.txt" },
      { id: 2, src: "待翻", dst: "", status: "NONE", file_path: "demo.txt" },
    ]);
    expect(read_meta(database, project_path)["translation_extras"]).toEqual(
      create_progress_snapshot({ line: 1, processed_line: 1 }),
    );
    expect(ack).toEqual({
      changed_item_ids: [1],
      section_revisions: { items: 1 },
    });
    expect(published_changes).toEqual([
      {
        source: "translation_batch_update",
        updatedSections: ["items"],
        items: {
          payloadMode: "canonical-delta",
          changedIds: [1],
        },
      },
    ]);
  });

  it("重翻 artifact 会推进 proofreading revision 并移除已完成行级范围", () => {
    const { database, project_path, runtime_state, store, published_changes } = create_store();
    seed_items(database, project_path);
    runtime_state.begin_task("translation", { kind: "items", item_ids: [1, 2] });

    const ack = store.commit_artifacts({
      task_type: "translation",
      artifacts: [
        {
          kind: "item_updates",
          source: "translation",
          items: [
            {
              id: 2,
              src: "待翻",
              dst: "重翻译文",
              status: "PROCESSED",
              file_path: "demo.txt",
            },
          ],
          affects_proofreading: true,
        },
      ],
      progress_snapshot: create_progress_snapshot({ line: 1, processed_line: 1 }),
    });

    const meta = read_meta(database, project_path);
    expect(meta["proofreading_revision.proofreading"]).toBe(1);
    expect(meta["project_runtime_revision.items"]).toBe(1);
    expect(ack).toEqual({
      changed_item_ids: [2],
      translation_scope: { kind: "items", item_ids: [1] },
      section_revisions: { items: 1, proofreading: 1 },
    });
    expect(published_changes).toEqual([
      {
        source: "retranslate_items",
        updatedSections: ["items", "proofreading"],
        items: {
          payloadMode: "canonical-delta",
          changedIds: [2],
        },
        sections: {
          proofreading: { payloadMode: "canonical-delta" },
        },
      },
    ]);
  });

  it("提交分析 artifact 时合并候选投票、写 checkpoint 并发布 analysis 变更", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T03:04:05.000Z"));
    const { database, project_path, store, published_changes } = create_store();
    database.execute({
      name: "upsertAnalysisCandidateAggregates",
      args: {
        projectPath: project_path,
        aggregates: [
          {
            src: "魔法",
            dst_votes: { magic: 1 },
            info_votes: { 术语: 1 },
            observation_count: 1,
            first_seen_at: "2026-01-01T00:00:00.000Z",
            last_seen_at: "2026-01-01T00:00:00.000Z",
            case_sensitive: false,
          },
        ],
      },
    });

    const ack = store.commit_artifacts({
      task_type: "analysis",
      artifacts: [
        {
          kind: "analysis_checkpoints",
          checkpoints: [
            {
              item_id: 1,
              status: "PROCESSED",
              updated_at: "2026-01-01T00:00:00.000Z",
              error_count: 0,
            },
            {
              item_id: -1,
              status: "PROCESSED",
              updated_at: "2026-01-01T00:00:00.000Z",
              error_count: 0,
            },
          ],
        },
        {
          kind: "analysis_candidates",
          entries: [
            { src: "魔法", dst: "spell", info: "术语", case_sensitive: true },
            { src: "魔法", dst: "spell", info: "术语", case_sensitive: true },
            { src: "人物", dst: "Alice", info: "Name", case_sensitive: false },
            { src: "空", dst: "", info: "术语", case_sensitive: false },
          ],
        },
      ],
      progress_snapshot: create_progress_snapshot({ total_line: 2, line: 1, processed_line: 1 }),
    });

    expect(
      database.execute({
        name: "getAnalysisItemCheckpoints",
        args: { projectPath: project_path },
      }),
    ).toEqual([
      {
        item_id: 1,
        status: "PROCESSED",
        updated_at: "2026-01-01T00:00:00.000Z",
        error_count: 0,
      },
    ]);
    const aggregates = Object.fromEntries(
      (
        database.execute({
          name: "getAnalysisCandidateAggregates",
          args: { projectPath: project_path },
        }) as MutableJsonRecord[]
      ).map((row) => [String(row["src"] ?? ""), row]),
    );
    expect(aggregates["魔法"]).toMatchObject({
      src: "魔法",
      dst_votes: { magic: 1, spell: 1 },
      info_votes: { 术语: 2 },
      observation_count: 2,
      first_seen_at: "2026-01-01T00:00:00.000Z",
      last_seen_at: "2026-01-02T03:04:05.000Z",
      case_sensitive: true,
    });
    expect(aggregates["人物"]).toMatchObject({
      src: "人物",
      dst_votes: { Alice: 1 },
      info_votes: { Name: 1 },
      observation_count: 1,
      first_seen_at: "2026-01-02T03:04:05.000Z",
      last_seen_at: "2026-01-02T03:04:05.000Z",
      case_sensitive: false,
    });
    expect(read_meta(database, project_path)).toMatchObject({
      analysis_extras: create_progress_snapshot({ total_line: 2, line: 1, processed_line: 1 }),
      analysis_candidate_count: 2,
      "project_runtime_revision.analysis": 1,
    });
    expect(ack).toEqual({
      inserted_count: 2,
      analysis_candidate_count: 2,
      section_revisions: { analysis: 1 },
    });
    expect(published_changes).toEqual([
      {
        source: "analysis_batch_update",
        updatedSections: ["analysis"],
        sections: {
          analysis: { payloadMode: "canonical-delta" },
        },
      },
    ]);
  });

  function create_store(): {
    database: ProjectDatabase;
    project_path: string;
    runtime_state: TaskRuntimeState;
    store: ProjectTaskStore;
    published_changes: MutableJsonRecord[];
  } {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-project-task-store-"));
    const project_path = path.join(directory, "task.lg");
    const database = new ProjectDatabase();
    const session_state = new ProjectSessionState();
    const runtime_state = new TaskRuntimeState();
    const published_changes: MutableJsonRecord[] = [];
    database.execute({
      name: "createProject",
      args: { projectPath: project_path, name: "task" },
    });
    session_state.mark_loaded(project_path);
    cleanup_callbacks.push(() => fs.rmSync(directory, { recursive: true, force: true }));
    cleanup_callbacks.push(() => database.close());
    return {
      database,
      project_path,
      runtime_state,
      store: new ProjectTaskStore(database, session_state, runtime_state, {
        publish_project_change: (payload: MutableJsonRecord) => {
          published_changes.push(payload);
        },
      } as unknown as ProjectChangePublisher),
      published_changes,
    };
  }

  function seed_items(database: ProjectDatabase, project_path: string): void {
    database.execute({
      name: "setItems",
      args: {
        projectPath: project_path,
        items: [
          { id: 1, src: "原文", dst: "", status: "NONE", file_path: "demo.txt" },
          { id: 2, src: "待翻", dst: "", status: "NONE", file_path: "demo.txt" },
        ],
      },
    });
  }

  function create_progress_snapshot(overrides: Partial<MutableJsonRecord> = {}): MutableJsonRecord {
    return {
      start_time: 10,
      time: 0,
      total_line: 2,
      line: 0,
      processed_line: 0,
      error_line: 0,
      total_tokens: 3,
      total_input_tokens: 1,
      total_output_tokens: 2,
      ...overrides,
    };
  }

  function read_items(database: ProjectDatabase, project_path: string): ApiJsonValue {
    return database.execute({ name: "getAllItems", args: { projectPath: project_path } });
  }

  function read_meta(database: ProjectDatabase, project_path: string): MutableJsonRecord {
    return database.execute({
      name: "getAllMeta",
      args: { projectPath: project_path },
    }) as unknown as MutableJsonRecord;
  }
});
