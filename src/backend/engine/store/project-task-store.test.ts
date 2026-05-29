import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiJsonValue } from "../../api/api-types";
import { ProjectEventBus } from "../../project/project-events";
import { ProjectDataCache } from "../../project/project-data";
import { ProjectDatabase } from "../../database/database-operations";
import type { ProjectChangePublisher } from "../../project/project-changes";
import { ProjectMutationStore } from "../../project/project-mutation-store";
import { ProjectSessionState } from "../../project/project-session";
import { TaskRunState } from "../run/task-run-state";
import type { MutableJsonRecord } from "../run/task-run-types";
import { ProjectTaskStore } from "./project-task-store";

describe("ProjectTaskStore", () => {
  const cleanup_callbacks: Array<() => void> = [];

  afterEach(() => {
    vi.useRealTimers();
    while (cleanup_callbacks.length > 0) {
      cleanup_callbacks.pop()?.();
    }
  });

  it("提交翻译 artifact 时写入 items、进度 meta 并发布行级 items 变更", async () => {
    const { database, project_path, store, published_changes } = create_store();
    seed_items(database, project_path);

    const ack = await store.commit_artifacts({
      task_type: "translation",
      artifacts: [
        {
          kind: "item_updates",
          source: "translation",
          items: [
            {
              item_id: 1,
              dst: "译文",
              name_dst: "译名",
              status: "PROCESSED",
              retry_count: 0,
            },
          ],
          affects_proofreading: false,
        },
      ],
      progress_snapshot: create_progress_snapshot({ line: 1, processed_line: 1 }),
    });

    expect(read_items(database, project_path)).toEqual([
      {
        id: 1,
        src: "原文",
        dst: "译文",
        name_src: "原名",
        name_dst: "译名",
        status: "PROCESSED",
        retry_count: 0,
        file_path: "demo.txt",
        file_type: "TXT",
        text_type: "TXT",
        row: 7,
        extra_field: { speaker: "春" },
      },
      {
        id: 2,
        src: "待翻",
        dst: "",
        status: "NONE",
        retry_count: 0,
        file_path: "demo.txt",
        file_type: "TXT",
        text_type: "TXT",
        row: 8,
      },
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
        targetProjectPath: project_path,
        source: "translation_batch_update",
        updatedSections: ["items"],
        items: {
          payloadMode: "canonical-delta",
          changedIds: [1],
        },
      },
    ]);
  });

  it("重翻 artifact 会推进 proofreading revision 并移除已完成行级范围", async () => {
    const { database, project_path, run_state, store, published_changes } = create_store();
    seed_items(database, project_path);
    run_state.begin_task("translation", { kind: "items", item_ids: [1, 2] });

    const ack = await store.commit_artifacts({
      task_type: "translation",
      artifacts: [
        {
          kind: "item_updates",
          source: "translation",
          items: [
            {
              item_id: 2,
              dst: "重翻译文",
              status: "PROCESSED",
              retry_count: 0,
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
        targetProjectPath: project_path,
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

  it("提交分析 artifact 时合并候选投票、写 checkpoint 并发布 analysis 变更", async () => {
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
    database.execute({
      name: "setMeta",
      args: { projectPath: project_path, key: "analysis_candidate_count", value: 1 },
    });
    const execute_spy = vi.spyOn(database, "execute");
    execute_spy.mockClear();

    const ack = await store.commit_artifacts({
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

    expect(execute_spy).toHaveBeenCalledWith({
      name: "getAnalysisCandidateAggregatesBySrcs",
      args: { projectPath: project_path, srcs: ["魔法", "人物"] },
    });
    expect(execute_spy).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: "getAnalysisCandidateAggregates" }),
    );
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
        targetProjectPath: project_path,
        source: "analysis_batch_update",
        updatedSections: ["analysis"],
        sections: {
          analysis: {
            payloadMode: "canonical-delta",
            data: {
              extras: create_progress_snapshot({
                total_line: 2,
                line: 1,
                processed_line: 1,
              }),
              candidate_count: 2,
              status_summary: {
                total_line: 2,
                processed_line: 1,
                error_line: 0,
                line: 1,
              },
            },
          },
        },
      },
    ]);
  });

  it("构建任务质量快照时保留工程自定义提示词启用态", async () => {
    const { project_data_cache, database, project_path, store } = create_store();
    database.execute({
      name: "setRuleText",
      args: {
        projectPath: project_path,
        ruleType: "translation_prompt",
        text: "自定义翻译提示词",
      },
    });
    database.execute({
      name: "setRuleText",
      args: {
        projectPath: project_path,
        ruleType: "analysis_prompt",
        text: "自定义分析提示词",
      },
    });
    database.execute({
      name: "upsertMetaEntries",
      args: {
        projectPath: project_path,
        meta: {
          translation_prompt_enable: true,
          analysis_prompt_enable: true,
          "quality_prompt_revision.translation": 2,
          "quality_prompt_revision.analysis": 2,
        },
      },
    });
    await project_data_cache.warmProject(project_path);

    const snapshot = store.build_quality_snapshot() as MutableJsonRecord;
    const prompts = snapshot["prompts"] as MutableJsonRecord;

    expect(prompts["translation"]).toEqual({
      text: "自定义翻译提示词",
      enabled: true,
      revision: 2,
    });
    expect(prompts["analysis"]).toEqual({
      text: "自定义分析提示词",
      enabled: true,
      revision: 2,
    });
  });

  it("构建任务质量快照时术语表缺启用 meta 仍按领域默认值启用", async () => {
    const { project_data_cache, database, project_path, store } = create_store();
    database.execute({
      name: "setRules",
      args: {
        projectPath: project_path,
        ruleType: "glossary",
        rules: [{ src: "HP", dst: "生命值" }],
      },
    });
    await project_data_cache.warmProject(project_path);

    const snapshot = store.build_quality_snapshot() as MutableJsonRecord;
    const quality = snapshot["quality"] as MutableJsonRecord;

    expect(quality["glossary"]).toEqual({
      entries: [{ src: "HP", dst: "生命值" }],
      enabled: true,
      revision: 0,
    });
  });

  it("任务提交等待内部事件完成后再发布公开项目变更", async () => {
    const calls: string[] = [];
    const { database, project_path, project_event_bus, store } = create_store({
      on_publish_project_change: () => calls.push("public"),
    });
    seed_items(database, project_path);
    project_event_bus.subscribe("project.items.changed", async () => {
      calls.push("internal:start");
      await Promise.resolve();
      calls.push("internal:end");
    });

    await store.commit_artifacts({
      task_type: "translation",
      artifacts: [
        {
          kind: "item_updates",
          source: "translation",
          items: [
            {
              item_id: 1,
              dst: "译文",
              status: "PROCESSED",
              retry_count: 0,
            },
          ],
          affects_proofreading: false,
        },
      ],
      progress_snapshot: create_progress_snapshot({ line: 1, processed_line: 1 }),
    });

    expect(calls).toEqual(["internal:start", "internal:end", "public"]);
  });

  function create_store(options: { on_publish_project_change?: () => void } = {}): {
    database: ProjectDatabase;
    project_path: string;
    run_state: TaskRunState;
    project_data_cache: ProjectDataCache;
    project_event_bus: ProjectEventBus;
    store: ProjectTaskStore;
    published_changes: MutableJsonRecord[];
  } {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-project-task-store-"));
    const project_path = path.join(directory, "task.lg");
    const database = new ProjectDatabase();
    const session_state = new ProjectSessionState();
    const run_state = new TaskRunState();
    const project_data_cache = new ProjectDataCache(database);
    const project_event_bus = new ProjectEventBus();
    const published_changes: MutableJsonRecord[] = [];
    database.execute({
      name: "createProject",
      args: { projectPath: project_path, name: "task" },
    });
    session_state.mark_loaded(project_path);
    cleanup_callbacks.push(() => fs.rmSync(directory, { recursive: true, force: true }));
    cleanup_callbacks.push(() => database.close());
    const mutation_store = new ProjectMutationStore(database, project_event_bus, {
      publish_project_change: (payload: MutableJsonRecord) => {
        options.on_publish_project_change?.();
        published_changes.push(payload);
      },
    } as unknown as ProjectChangePublisher);
    return {
      database,
      project_path,
      run_state,
      project_data_cache,
      store: new ProjectTaskStore(
        database,
        session_state,
        run_state,
        project_data_cache,
        mutation_store,
      ),
      published_changes,
      project_event_bus,
    };
  }

  function seed_items(database: ProjectDatabase, project_path: string): void {
    database.execute({
      name: "setItems",
      args: {
        projectPath: project_path,
        items: [
          {
            id: 1,
            src: "原文",
            dst: "",
            name_src: "原名",
            name_dst: null,
            status: "NONE",
            retry_count: 2,
            file_path: "demo.txt",
            file_type: "TXT",
            text_type: "TXT",
            row: 7,
            extra_field: { speaker: "春" },
          },
          {
            id: 2,
            src: "待翻",
            dst: "",
            status: "NONE",
            retry_count: 0,
            file_path: "demo.txt",
            file_type: "TXT",
            text_type: "TXT",
            row: 8,
          },
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
