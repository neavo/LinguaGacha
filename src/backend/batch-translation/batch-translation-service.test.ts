import { Model } from "../../domain/model";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ProjectDatabase } from "../database/database-operations";
import { ProjectWriteStore } from "../project/project-write-store";
import { CacheManager } from "../cache/cache-manager";
import { BatchTranslationProjectStore } from "./batch-translation-project-store";
import { TranslationPlanner } from "./planning/translation-planner";
import { PlanningWorkerPool } from "./planning/planning-worker-pool";
import { describe, expect, it, vi } from "vitest";
import { BatchTranslationService } from "./batch-translation-service";
import { BatchTranslationRuntime } from "./batch-translation-runtime";
import { RuntimeOperationGate } from "../runtime-operation-gate";
import { ProjectSessionState } from "../project/project-session-state";
import { ProjectDataReader } from "../project/project-data-reader";
import { BatchTranslationRunner } from "./core/batch-translation-runner";
import { normalize_batch_translation_progress } from "../../domain/batch-translation";

function setup(loaded = true, line = 0) {
  const session = new ProjectSessionState();
  if (loaded) session.mark_loaded("E:/Project/test.lg");
  const gate = new RuntimeOperationGate();
  const runtime = new BatchTranslationRuntime(
    session,
    { get_all_meta: () => ({ translation_extras: { line } }) } as unknown as ProjectDataReader,
    gate,
  );
  const run = vi.fn<BatchTranslationRunner["run"]>(async () => ({
    status: "done",
    progress: normalize_batch_translation_progress({ line }),
  }));
  const service = new BatchTranslationService(
    { run } as unknown as BatchTranslationRunner,
    runtime,
    session,
    {
      read_setting: () => ({
        models: [{ id: "translation" }],
        model_selection: { translation: "translation" },
      }),
    },
  );
  return { service, runtime, gate, run };
}

describe("批量翻译服务", () => {
  it("重翻在入口去重保序，并沿同一运行链提交", async () => {
    const { service, runtime, run } = setup();
    expect(
      await service.start({
        mode: "new",
        scope: { kind: "items", item_ids: [2, "1", 2, true, 1.5, -1] },
      }),
    ).toMatchObject({ accepted: true });
    await runtime.dispose();
    expect(run.mock.calls[0]?.[1]).toEqual({
      mode: "new",
      scope: { kind: "items", item_ids: [2, 1] },
    });
    expect(run.mock.calls[0]?.[2].model.id).toBe("translation");
  });
  it.each<import("../../domain/json").JsonRecord>([
    {},
    { kind: "items", item_ids: [] },
    { kind: "items", item_ids: [false, 0, 1.5] },
  ])("拒绝不完整 scope %j", async (scope) => {
    const { service, runtime, run } = setup();
    await expect(service.start({ scope })).rejects.toMatchObject({
      code: "request.validation_failed",
    });
    expect(run).not.toHaveBeenCalled();
    await runtime.dispose();
  });
  it("工程未加载时不预约运行", async () => {
    const { service, runtime, gate } = setup(false);
    await expect(service.start({ mode: "new" })).rejects.toMatchObject({
      code: "project.not_loaded",
    });
    expect(gate.get_snapshot().owner).toBeNull();
    await runtime.dispose();
  });
  it.each([0, 3])("Agent 按当前累计进度 %i 选择模式并等待 completion", async (line) => {
    const { service, runtime, gate, run } = setup(true, line);
    let finish!: () => void;
    const work = new Promise<void>((resolve) => {
      finish = resolve;
    });
    run.mockImplementation(async () => {
      await work;
      return { status: "done", progress: normalize_batch_translation_progress({ line }) };
    });
    const lease = gate.begin_runtime("agent");
    const completed = vi.fn();
    const inherited = Model.from_json(
      { id: "agent", model_id: "agent-model", thinking: { level: "HIGH" } },
      "agent",
    );
    const result = service
      .run_under_agent(lease, new AbortController().signal, inherited)
      .then((value) => {
        completed();
        return value;
      });
    await vi.waitFor(() => expect(run).toHaveBeenCalled());
    expect(completed).not.toHaveBeenCalled();
    expect(run.mock.calls[0]?.[2].model).toMatchObject({
      id: "agent",
      model_id: "agent-model",
      thinking: { level: "HIGH" },
    });
    expect(run.mock.calls[0]?.[2].model.thinking).not.toBe(inherited.thinking);
    expect(run.mock.calls[0]?.[1]).toEqual({
      mode: line > 0 ? "continue" : "new",
      scope: { kind: "all" },
    });
    await expect(service.start({ mode: "new" })).rejects.toMatchObject({ code: "runtime.busy" });
    finish();
    expect((await result).progress.line).toBe(line);
    expect(gate.get_snapshot().owner).toBe("agent");
    gate.finish_runtime(lease);
    await runtime.dispose();
  });
  it("普通项目写持有互斥时不能启动", async () => {
    const { service, runtime, gate } = setup();
    await gate.run_project_write(async () => {
      await expect(service.start({ mode: "new" })).rejects.toMatchObject({ code: "runtime.busy" });
    });
    await runtime.dispose();
  });
});

it("历史工程批量翻译保留旧分析物理数据、正式术语与资产，并只投影当前能力", async () => {
  using directory = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-batch-history-"));
  const project_path = path.join(directory.path, "history.lg");
  const database = new ProjectDatabase();
  database.create_project(project_path, "history");
  database.set_items(project_path, [
    {
      id: 1,
      src: "Hello",
      dst: "",
      name_src: null,
      name_dst: null,
      extra_field: "",
      tag: "",
      skip_internal_filter: false,
      status: "NONE",
      file_path: "text.txt",
      file_type: "TXT",
      text_type: "NONE",
      row: 0,
      retry_count: 0,
    },
  ]);
  database.set_rules(project_path, "glossary", [
    { entry_id: "HELLO", src: "Hello", dst: "你好", info: "", case_sensitive: false },
  ]);
  database.set_rule_text(project_path, "translation_prompt", "Translate to {target_language}");
  database.set_meta(project_path, "translation_prompt_enable", true);
  const source = path.join(directory.path, "text.txt");
  fs.writeFileSync(source, "Hello");
  database.add_asset_from_source(project_path, "text.txt", source);
  database.close();
  {
    using raw = new DatabaseSync(project_path);
    raw.exec(
      "CREATE TABLE analysis_item_checkpoint (item_id INTEGER PRIMARY KEY, status TEXT, updated_at TEXT, error_count INTEGER); CREATE TABLE analysis_candidate_aggregate (src TEXT PRIMARY KEY, dst_votes TEXT, info_votes TEXT, observation_count INTEGER, first_seen_index INTEGER); CREATE INDEX idx_analysis_item_checkpoint_status ON analysis_item_checkpoint(status);",
    );
    raw.prepare("INSERT INTO analysis_item_checkpoint VALUES (1, 'PROCESSED', 'old', 0)").run();
    raw
      .prepare(
        "INSERT INTO analysis_candidate_aggregate VALUES ('legacy', '{\"旧术语\":2}', '{}', 2, 1)",
      )
      .run();
    raw
      .prepare("INSERT INTO rules (type, data) VALUES (?, ?)")
      .run("analysis_prompt", JSON.stringify({ text: "historical prompt" }));
    for (const [key, value] of Object.entries({
      analysis_extras: { line: 9 },
      analysis_candidate_count: 1,
      "project_runtime_revision.analysis": 77,
      "quality_prompt_revision.analysis": 45,
    }))
      raw
        .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)")
        .run(key, JSON.stringify(value));
  }
  const before = read_history(project_path);
  const session = new ProjectSessionState();
  await session.mark_loaded(project_path);
  const cache = new CacheManager({
    database,
    logManager: { warning: vi.fn(), error: vi.fn() } as never,
    appSettingService: {
      read_setting: () => ({ source_language: "EN", target_language: "ZH" }),
    } as never,
    workerClient: { run: async () => ({}) } as never,
  });
  const writes = new ProjectWriteStore(database, vi.fn(), () => null);
  const runtime = new BatchTranslationRuntime(
    session,
    new ProjectDataReader(database),
    new RuntimeOperationGate(),
  );
  const planning = new PlanningWorkerPool({ execution: { kind: "in_process" } });
  try {
    await cache.warmProject(project_path);
    const reader = new ProjectDataReader(database);
    expect(reader.build_manifest(session.snapshot())).not.toHaveProperty(
      "sectionRevisions.analysis",
    );
    expect(cache.prompts.readBlock()).toHaveProperty(
      "translation.text",
      "Translate to {target_language}",
    );
    expect(cache.prompts.readBlock()).not.toHaveProperty("analysis");
    const runner = new BatchTranslationRunner({
      builtinRoot: path.join(process.cwd(), "builtin"),
      taskStore: new BatchTranslationProjectStore(database, session, cache, writes),
      taskRuntime: runtime,
      taskPlanner: new TranslationPlanner({ planningWorkerPool: planning }),
      executorClient: {
        execute_unit: async (unit) => ({
          unit_id: unit.unit_id,
          kind: "translation",
          outcome: "success",
          metrics: { input_tokens: 4, reasoning_tokens: 1, output_tokens: 2 },
          output: {
            kind: "translation",
            items: unit.payload.items.map((item) => ({
              ...item,
              dst: "你好",
              status: "PROCESSED",
            })),
          },
          logs: [],
        }),
      },
      logManager: { append: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() },
    });
    const service = new BatchTranslationService(runner, runtime, session, {
      read_setting: () => ({
        source_language: "EN",
        target_language: "ZH",
        model_selection: { translation: "fake" },
        models: [{ id: "fake", threshold: { concurrency_limit: 1 } }],
      }),
    });
    const handle = await service.start_current_project({ mode: "new", scope: { kind: "all" } });
    expect(await handle.completion).toMatchObject({
      status: "done",
      progress: { line: 1, processed_line: 1, total_tokens: 7 },
    });
    expect(database.get_all_items(project_path)).toEqual([
      expect.objectContaining({ dst: "你好", status: "PROCESSED" }),
    ]);
    expect(database.get_rules(project_path, "glossary")).toEqual([
      expect.objectContaining({ entry_id: "HELLO", dst: "你好" }),
    ]);
    expect(database.read_asset_content(project_path, "text.txt")?.toString()).toBe("Hello");
  } finally {
    await runtime.dispose();
    await planning.dispose();
    database.close();
  }
  expect(read_history(project_path)).toEqual(before);
});

/** 直接读取历史物理表，核对正式翻译前后的数据保全。 */
function read_history(project_path: string) {
  using raw = new DatabaseSync(project_path);
  return {
    checkpoints: raw.prepare("SELECT * FROM analysis_item_checkpoint").all(),
    candidates: raw.prepare("SELECT * FROM analysis_candidate_aggregate").all(),
    prompts: raw.prepare("SELECT * FROM rules WHERE type = 'analysis_prompt'").all(),
    meta: raw.prepare("SELECT * FROM meta WHERE key LIKE '%analysis%' ORDER BY key").all(),
  };
}
