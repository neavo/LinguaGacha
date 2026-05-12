import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectDatabase } from "../database/database-operations";
import type { TaskSnapshotBuilder } from "../task-engine/runtime/task-snapshot-builder";
import { ProjectRuntimeEncoder } from "./project-runtime-encoder";
import { get_runtime_section_revision } from "./project-section-revision";
import { ProjectSessionState } from "./project-session-state";

describe("ProjectRuntimeEncoder", () => {
  // 临时库必须按后进先出释放，确保 sqlite handle 先关再删目录。
  const cleanup_callbacks: Array<() => void> = [];

  afterEach(() => {
    while (cleanup_callbacks.length > 0) {
      cleanup_callbacks.pop()?.();
    }
  });

  it("按 数据库事实编码完整 bootstrap 事件和 section revision", async () => {
    const { database, project_path } = create_project_database();
    const service = new ProjectRuntimeEncoder(
      database,
      create_task_snapshot_builder({
        task_type: "retranslate",
        status: "RUNNING",
        busy: true,
        retranslating_item_ids: [101],
      }),
      create_session_state(project_path),
    );
    seed_runtime_project(database, project_path);

    const events = await service.build_bootstrap_events();
    const payloads = Object.fromEntries(
      events
        .filter((event) => event.event === "stage_payload")
        .map((event) => [String(event.data["stage"]), event.data["payload"]]),
    ) as Record<string, Record<string, unknown>>;
    const completed = events.at(-1);

    expect(events.map((event) => event.event)).toEqual([
      "stage_started",
      "stage_payload",
      "stage_completed",
      "stage_started",
      "stage_payload",
      "stage_completed",
      "stage_started",
      "stage_payload",
      "stage_completed",
      "stage_started",
      "stage_payload",
      "stage_completed",
      "stage_started",
      "stage_payload",
      "stage_completed",
      "stage_started",
      "stage_payload",
      "stage_completed",
      "stage_started",
      "stage_payload",
      "stage_completed",
      "stage_started",
      "stage_payload",
      "stage_completed",
      "completed",
    ]);
    expect(payloads["files"]).toEqual({
      fields: ["rel_path", "file_type", "sort_index"],
      rows: [
        ["script.xlsx", "XLSX", 0],
        ["notes.txt", "TXT", 1],
      ],
    });
    expect(payloads["items"]).toEqual({
      fields: [
        "item_id",
        "file_path",
        "row_number",
        "src",
        "dst",
        "name_src",
        "name_dst",
        "status",
        "text_type",
        "retry_count",
      ],
      rows: [
        [101, "script.xlsx", 2, "@12 你好", "", null, null, "PROCESSED", "WOLF", 2],
        [102, "script.xlsx", 3, "", "", null, null, "NONE", "NONE", 0],
        [103, "notes.txt", 4, "跳过", "", null, null, "EXCLUDED", "NONE", 0],
        [104, "notes.txt", 5, "失败", "", null, null, "NONE", "NONE", 0],
      ],
    });
    expect(payloads["quality"]?.["glossary"]).toMatchObject({
      enabled: true,
      entries: [{ src: "魔法", dst: "Magic", info: "", regex: false, case_sensitive: false }],
      revision: 5,
    });
    expect(payloads["quality"]?.["pre_replacement"]).toMatchObject({
      enabled: true,
      entries: [{ src: "Ａ", dst: "A", info: "", regex: false, case_sensitive: false }],
      revision: 4,
    });
    expect(payloads["quality"]?.["text_preserve"]).toMatchObject({
      enabled: false,
      mode: "smart",
      revision: 2,
    });
    expect(payloads["prompts"]?.["translation"]).toEqual({
      task_type: "translation",
      revision: 7,
      meta: { enabled: true },
      text: "翻译提示词",
    });
    expect(payloads["analysis"]).toMatchObject({
      extras: { total_tokens: 13 },
      candidate_count: 1,
      candidate_aggregate: {
        魔法: {
          src: "魔法",
          dst_votes: { Magic: 2 },
          info_votes: { 术语: 1 },
          observation_count: 2,
          case_sensitive: false,
        },
      },
      status_summary: {
        total_line: 2,
        processed_line: 1,
        error_line: 1,
        line: 2,
      },
    });
    expect(payloads["proofreading"]).toEqual({ revision: 6 });
    expect(payloads["task"]).toEqual({
      task_type: "retranslate",
      status: "RUNNING",
      busy: true,
      retranslating_item_ids: [101],
    });
    expect(completed).toEqual({
      event: "completed",
      data: {
        projectRevision: 9,
        sectionRevisions: {
          project: 0,
          files: 8,
          items: 9,
          quality: 5,
          prompts: 7,
          analysis: 3,
          proofreading: 6,
          task: 0,
        },
      },
    });
  });

  it("对坏 revision 和未知 section 统一归零", () => {
    expect(
      get_runtime_section_revision(
        {
          "project_runtime_revision.items": -1,
          "quality_rule_revision.glossary": "bad",
          "proofreading_revision.proofreading": 4.8,
        },
        "items",
      ),
    ).toBe(0);
    expect(
      get_runtime_section_revision(
        {
          "project_runtime_revision.items": -1,
          "quality_rule_revision.glossary": "bad",
          "proofreading_revision.proofreading": 4.8,
        },
        "proofreading",
      ),
    ).toBe(4);
    expect(get_runtime_section_revision({}, "unknown")).toBe(0);
  });

  /**
   * 创建真实临时 .lg，确保 runtime encoder 测试覆盖 database workflow 返回形状。
   */
  function create_project_database(): { database: ProjectDatabase; project_path: string } {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-runtime-test-"));
    const project_path = path.join(directory, "runtime.lg");
    const database = new ProjectDatabase();
    database.execute({
      name: "createProject",
      args: { projectPath: project_path, name: "runtime" },
    });
    cleanup_callbacks.push(() => fs.rmSync(directory, { force: true, recursive: true }));
    cleanup_callbacks.push(() => database.close());
    return { database, project_path };
  }

  /**
   * runtime encoder 只依赖任务快照 builder，测试用窄 fake 固定边界。
   */
  function create_task_snapshot_builder(
    task_snapshot: Record<string, unknown>,
  ): TaskSnapshotBuilder {
    return {
      build_task_snapshot: async () => task_snapshot,
    } as unknown as TaskSnapshotBuilder;
  }

  function create_session_state(project_path: string): ProjectSessionState {
    const session_state = new ProjectSessionState();
    session_state.mark_loaded(project_path);
    return session_state;
  }

  /**
   * 构造覆盖八个 bootstrap block 的项目事实，避免每个断言重复准备数据库。
   */
  function seed_runtime_project(database: ProjectDatabase, project_path: string): void {
    database.execute_transaction([
      {
        name: "setItems",
        args: {
          projectPath: project_path,
          items: [
            {
              id: 101,
              file_path: "script.xlsx",
              file_type: "XLSX",
              row: 2,
              src: "@12 你好",
              dst: "",
              status: "PROCESSED",
              text_type: "WOLF",
              retry_count: 2,
            },
            {
              id: 102,
              file_path: "script.xlsx",
              file_type: "XLSX",
              row: 3,
              src: "",
              dst: "",
              status: "NONE",
            },
            {
              id: 103,
              file_path: "notes.txt",
              file_type: "TXT",
              row: 4,
              src: "跳过",
              dst: "",
              status: "EXCLUDED",
            },
            {
              id: 104,
              file_path: "notes.txt",
              file_type: "TXT",
              row: 5,
              src: "失败",
              dst: "",
              status: "NONE",
            },
          ],
        },
      },
      {
        name: "upsertMetaEntries",
        args: {
          projectPath: project_path,
          meta: {
            "project_runtime_revision.files": 8,
            "project_runtime_revision.items": 9,
            "project_runtime_revision.analysis": 3,
            "quality_rule_revision.glossary": 5,
            "quality_rule_revision.pre_replacement": 4,
            "quality_rule_revision.post_replacement": 1,
            "quality_rule_revision.text_preserve": 2,
            "quality_prompt_revision.translation": 7,
            "quality_prompt_revision.analysis": 2,
            "proofreading_revision.proofreading": 6,
            glossary_enable: true,
            pre_translation_replacement_enable: true,
            post_translation_replacement_enable: false,
            text_preserve_mode: "smart",
            translation_prompt_enable: true,
            analysis_prompt_enable: false,
            analysis_extras: { total_tokens: 13 },
            analysis_candidate_count: 1,
          },
        },
      },
      {
        name: "setRules",
        args: {
          projectPath: project_path,
          ruleType: "glossary",
          rules: [{ src: "魔法", dst: "Magic", info: "", regex: false, case_sensitive: false }],
        },
      },
      {
        name: "setRules",
        args: {
          projectPath: project_path,
          ruleType: "pre_translation_replacement",
          rules: [{ src: "Ａ", dst: "A", info: "", regex: false, case_sensitive: false }],
        },
      },
      {
        name: "setRuleText",
        args: { projectPath: project_path, ruleType: "translation_prompt", text: "翻译提示词" },
      },
      {
        name: "setRuleText",
        args: { projectPath: project_path, ruleType: "analysis_prompt", text: "分析提示词" },
      },
      {
        name: "upsertAnalysisItemCheckpoints",
        args: {
          projectPath: project_path,
          checkpoints: [
            { item_id: 101, status: "PROCESSED", updated_at: "2026-01-01", error_count: 0 },
            { item_id: 104, status: "ERROR", updated_at: "2026-01-01", error_count: 1 },
          ],
        },
      },
      {
        name: "upsertAnalysisCandidateAggregates",
        args: {
          projectPath: project_path,
          aggregates: [
            {
              src: "魔法",
              dst_votes: { Magic: 2 },
              info_votes: { 术语: 1 },
              observation_count: 2,
              first_seen_at: "2026-01-01",
              last_seen_at: "2026-01-02",
              case_sensitive: false,
            },
          ],
        },
      },
    ]);
  }
});
