import { create_item } from "../../domain/item";
import { ProjectDataReader } from "../project/project-data-reader";
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
import { BatchTranslationRunner } from "./core/batch-translation-runner";
import { normalize_batch_translation_progress } from "../../domain/batch-translation";
import { DEFAULT_PROJECT_LANGUAGE_SETTINGS } from "../../domain/project-settings";

/** 组合真实任务服务与可控协作者，观察启动和停止命令。 */
function setup(loaded = true, line = 0) {
  const session = new ProjectSessionState();
  if (loaded) session.mark_loaded("E:/Project/test.lg");
  const gate = new RuntimeOperationGate();
  const runtime = new BatchTranslationRuntime(
    session,
    {
      get_all_meta: () => ({ translation_extras: { processed_line: line } }),
    } as unknown as ProjectDatabase,
    gate,
  );
  const run = vi.fn<BatchTranslationRunner["run"]>(async () => ({
    status: "done",
    progress: normalize_batch_translation_progress({ processed_line: line }),
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
    { readBlock: () => DEFAULT_PROJECT_LANGUAGE_SETTINGS },
  );
  return { service, runtime, gate, run };
}

describe("批量翻译服务", () => {
  it("普通入口拒绝已删除的失败参数", async () => {
    const { service, runtime, run } = setup();
    await expect(
      service.start({
        operation: "translate",
        mode: "continue",
        scope: { kind: "all" },
        include_errors: true,
      }),
    ).rejects.toMatchObject({ code: "request.validation_failed" });
    expect(run).not.toHaveBeenCalled();
    await runtime.dispose();
  });
  it("重翻在入口去重保序，并沿同一运行链提交", async () => {
    const { service, runtime, run } = setup();
    expect(
      await service.start({
        operation: "retranslate",
        scope: { kind: "items", item_ids: [2, 1, 2] },
      }),
    ).toMatchObject({ accepted: true });
    await runtime.dispose();
    expect(run.mock.calls[0]?.[1]).toEqual({
      operation: "retranslate",
      mode: "continue",
      item_ids: [2, 1],
    });
    expect(run.mock.calls[0]?.[2].model.id).toBe("translation");
  });
  it.each<import("../../domain/json").JsonRecord>([
    {},
    { kind: "items", item_ids: [] },
    { kind: "items", item_ids: [false, 0, 1.5] },
  ])("拒绝不完整 scope %j", async (scope) => {
    const { service, runtime, run } = setup();
    await expect(service.start({ operation: "translate", scope })).rejects.toMatchObject({
      code: "request.validation_failed",
    });
    expect(run).not.toHaveBeenCalled();
    await runtime.dispose();
  });
  it("工程未加载时不预约运行", async () => {
    const { service, runtime, gate } = setup(false);
    await expect(
      service.start({ operation: "translate", mode: "new", scope: { kind: "all" } }),
    ).rejects.toMatchObject({
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
      return {
        status: "done",
        progress: normalize_batch_translation_progress({ processed_line: line }),
      };
    });
    const lease = gate.begin_runtime("agent");
    const completed = vi.fn();
    const inherited = Model.from_json(
      { id: "agent", model_id: "agent-model", thinking: { level: "HIGH" } },
      "agent",
    );
    const result = service
      .run_under_agent(lease, new AbortController().signal, inherited, {
        item_ids: [2],
        item_statuses: ["NONE"],
      })
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
      operation: "translate",
      item_statuses: ["NONE"],
      mode: line > 0 ? "continue" : "new",
      item_ids: [2],
    });
    await expect(
      service.start({ operation: "translate", mode: "new", scope: { kind: "all" } }),
    ).rejects.toMatchObject({ code: "runtime.busy" });
    finish();
    expect((await result).progress.processed_line).toBe(line);
    expect(gate.get_snapshot().owner).toBe("agent");
    gate.finish_runtime(lease);
    await runtime.dispose();
  });
  it.each([
    {},
    { item_ids: [] },
    { item_statuses: [] },
    { item_ids: [0] },
    { item_ids: [false] },
    { item_ids: [1.5] },
    { item_ids: [Number.MAX_SAFE_INTEGER + 1] },
    { item_statuses: ["ALL"] },
    { item_statuses: null },
    { item_ids: null },
    { scope: { kind: "all" }, include_errors: false },
  ])("Agent 在预约前拒绝非法条件 %j", async (request) => {
    const { service, runtime, gate, run } = setup();
    const lease = gate.begin_runtime("agent");
    await expect(
      service.run_under_agent(
        lease,
        new AbortController().signal,
        Model.from_json({ id: "agent" }, "agent"),
        request as unknown as import("../../domain/batch-translation").AgentBatchTranslationRequest,
      ),
    ).rejects.toMatchObject({ code: "request.validation_failed" });
    expect(run).not.toHaveBeenCalled();
    expect((await runtime.build_snapshot()).status).toBe("idle");
    gate.finish_runtime(lease);
    await runtime.dispose();
  });
  it.each([
    { mode: "new" as const, statuses: ["NONE"] },
    { mode: "continue" as const, statuses: ["NONE"] },
    { mode: "reset" as const, statuses: undefined },
  ])("工作台入口显式转换状态条件 $mode", async ({ mode, statuses }) => {
    const { service, runtime, run } = setup();
    const handle = await service.start_current_project({
      operation: "translate",
      mode,
      scope: { kind: "all" },
    });
    await handle.completion;
    expect(run.mock.calls[0]?.[1]).toEqual({
      operation: "translate",
      mode,
      ...(statuses === undefined ? {} : { item_statuses: statuses }),
    });
    await runtime.dispose();
  });
  it("普通项目写持有互斥时不能启动", async () => {
    const { service, runtime, gate } = setup();
    await gate.run_project_write(async () => {
      await expect(
        service.start({ operation: "translate", mode: "new", scope: { kind: "all" } }),
      ).rejects.toMatchObject({ code: "runtime.busy" });
    });
    await runtime.dispose();
  });
});

it.each([
  { request: { item_ids: [2, 1, 2] }, targets: [1, 2] },
  {
    request: { item_ids: [1, 2], item_statuses: ["PROCESSED"] as const },
    targets: [1],
  },
  { request: { item_statuses: ["EXCLUDED"] as const }, targets: [2] },
])("Agent 发布实际目标与总量，提交后清空目标 $request", async ({ request, targets }) => {
  using directory = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-agent-targets-"));
  const project_path = path.join(directory.path, "targets.lg");
  const database = new ProjectDatabase("1.0.0");
  await database.create_project(project_path, "targets");
  const original = ["PROCESSED", "EXCLUDED", "NONE"].map((status, index) =>
    create_item({
      id: index + 1,
      src: `Source ${index}`,
      dst: "原有译文",
      status,
      file_path: "text.txt",
      row: index,
    }),
  );
  await database.transaction(project_path, (writer) => {
    writer.set_items(project_path, original);
    writer.upsert_meta_entries(project_path, { source_language: "EN", target_language: "ZH" });
  });
  const session = new ProjectSessionState();
  session.mark_loaded(project_path);
  const gate = new RuntimeOperationGate();
  const runtime = new BatchTranslationRuntime(session, database, gate);
  const settings = { read_setting: () => ({}) };
  const cache = new CacheManager({
    database,
    logManager: null,
    workerClient: { run: vi.fn() } as never,
  });
  const writes = new ProjectWriteStore(database, vi.fn(), () => null);
  const planning = new PlanningWorkerPool({ execution: { kind: "in_process" } });
  const execute_unit = vi.fn<import("./protocol/work-unit").WorkUnitExecutor["execute_unit"]>(
    async (unit) => ({
      unit_id: unit.unit_id,
      kind: "translation",
      outcome: "success",
      metrics: { input_tokens: 4, reasoning_tokens: 1, output_tokens: 2 },
      output: {
        kind: "translation",
        items: unit.payload.items.map((item) => ({ ...item, dst: "新译文", status: "PROCESSED" })),
      },
      logs: [],
    }),
  );
  const runner = new BatchTranslationRunner({
    builtinRoot: path.join(process.cwd(), "builtin"),
    taskStore: new BatchTranslationProjectStore(session, cache, writes),
    taskRuntime: runtime,
    taskPlanner: new TranslationPlanner({ planningWorkerPool: planning }),
    executorClient: { execute_unit },
    logManager: { append: vi.fn() },
    llmClient: {
      request: async () => {
        throw new Error("Unexpected LLM request");
      },
    },
  });
  const service = new BatchTranslationService(runner, runtime, session, settings, cache.languages);
  const lease = gate.begin_runtime("agent");
  const model = Model.from_json({ id: "fake", threshold: { concurrency_limit: 1 } }, "fake");
  try {
    await cache.warmProject(project_path);
    const frames: import("../../domain/batch-translation").BatchTranslationSnapshot[] = [];
    runtime.subscribe((snapshot) => {
      frames.push(snapshot);
    });
    const result = await service.run_under_agent(
      lease,
      new AbortController().signal,
      model,
      request,
    );
    expect(frames[0]).toMatchObject({
      status: "requested",
      pending_item_ids: [],
      run_progress: undefined,
    });
    const prepared = frames.find((frame) => frame.run_progress !== undefined);
    expect(prepared).toMatchObject({
      pending_item_ids: targets,
      run_progress: { total_line: targets.length, processed_line: 0 },
    });
    expect(frames.at(-1)).toMatchObject({
      status: "done",
      pending_item_ids: [],
      run_progress: { total_line: targets.length, processed_line: targets.length },
    });
    expect(result).toMatchObject({
      status: "done",
      run_progress: { total_line: targets.length, processed_line: targets.length },
      progress: {
        total_line: targets.includes(2) ? 3 : 2,
        processed_line: targets.includes(2) ? 2 : 1,
      },
    });
    expect(result.progress.total_tokens).toBeGreaterThan(0);
    // Agent 内批量翻译同样采用项目语言作为本轮执行快照。
    expect(execute_unit.mock.calls[0]![0].config_snapshot).toMatchObject({
      source_language: "EN",
      target_language: "ZH",
    });
    expect(await database.get_all_items(project_path)).toEqual([
      targets.includes(1) ? { ...original[0], dst: "新译文" } : original[0],
      targets.includes(2) ? { ...original[1], dst: "新译文", status: "PROCESSED" } : original[1],
      original[2],
    ]);
    const meta = await database.get_all_meta(project_path);
    expect(meta["proofreading_revision.proofreading"]).toBeGreaterThan(0);
    expect(meta["translation_extras"]).toMatchObject({
      total_tokens: result.progress.total_tokens,
    });
    await cache.warmProject(project_path);
    execute_unit.mockClear();
    frames.length = 0;
    expect(
      await service.run_under_agent(lease, new AbortController().signal, model, {
        item_ids: [1, 2],
        item_statuses: ["NONE"],
      }),
    ).toMatchObject({
      status: "done",
      run_progress: { total_line: 0, processed_line: 0 },
      progress: { total_tokens: result.progress.total_tokens },
    });
    // 运行失败连同终态统计和原始原因交给 Agent。
    await expect(
      service.run_under_agent(lease, new AbortController().signal, model, {
        item_ids: [3, 99],
        item_statuses: ["NONE"],
      }),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ code: "request.validation_failed" }),
      result: { status: "error" },
    });
    expect(execute_unit).not.toHaveBeenCalled();
    expect(frames.every((frame) => frame.pending_item_ids.length === 0)).toBe(true);
    expect((await database.get_all_meta(project_path))["proofreading_revision.proofreading"]).toBe(
      meta["proofreading_revision.proofreading"],
    );
    expect((await database.get_all_items(project_path))[2]).toEqual(original[2]);
  } finally {
    gate.finish_runtime(lease);
    await runtime.dispose();
    await planning.dispose();
    await database.close();
  }
});

it("历史工程批量翻译保留旧分析物理数据、正式术语与资产，并只投影当前能力", async () => {
  using directory = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-batch-history-"));
  const project_path = path.join(directory.path, "history.lg");
  const database = new ProjectDatabase("1.0.0");
  await database.create_project(project_path, "history");
  await database.transaction(project_path, (writer) =>
    writer.set_items(project_path, [
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
        row: 0,
      },
    ]),
  );
  await database.transaction(project_path, (writer) =>
    writer.set_rules(project_path, "glossary", [
      { entry_id: "HELLO", src: "Hello", dst: "你好", info: "", case_sensitive: false },
    ]),
  );
  await database.transaction(project_path, (writer) =>
    writer.set_rule_text(project_path, "translation_prompt", "Translate to {target_language}"),
  );
  await database.transaction(project_path, (writer) => {
    writer.set_meta(project_path, "translation_prompt_enable", true);
    writer.upsert_meta_entries(project_path, { source_language: "EN", target_language: "ZH" });
  });
  await database.transaction(project_path, (writer) =>
    writer.add_asset(project_path, "text.txt", Buffer.from("Hello"), "TXT", null),
  );
  await database.close();
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
    workerClient: { run: async () => ({}) } as never,
  });
  const writes = new ProjectWriteStore(database, vi.fn(), () => null);
  const runtime = new BatchTranslationRuntime(session, database, new RuntimeOperationGate());
  const planning = new PlanningWorkerPool({ execution: { kind: "in_process" } });
  try {
    await cache.warmProject(project_path);

    expect(
      await database.read(project_path, (access) =>
        new ProjectDataReader(access).build_manifest(session.snapshot()),
      ),
    ).not.toHaveProperty("sectionRevisions.analysis");
    expect(cache.prompts.readBlock()).toHaveProperty(
      "translation.text",
      "Translate to {target_language}",
    );
    expect(cache.prompts.readBlock()).not.toHaveProperty("analysis");
    const runner = new BatchTranslationRunner({
      llmClient: {
        request: async () => {
          throw new Error("Unexpected LLM request");
        },
      },
      builtinRoot: path.join(process.cwd(), "builtin"),
      taskStore: new BatchTranslationProjectStore(session, cache, writes),
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
      logManager: { append: vi.fn() },
    });
    const service = new BatchTranslationService(
      runner,
      runtime,
      session,
      {
        read_setting: () => ({
          model_selection: { translation: "fake" },
          models: [{ id: "fake", threshold: { concurrency_limit: 1 } }],
        }),
      },
      cache.languages,
    );
    const handle = await service.start_current_project({
      operation: "translate",
      mode: "new",
      scope: { kind: "all" },
    });
    expect(await handle.completion).toMatchObject({
      status: "done",
      progress: { processed_line: 1, total_tokens: 7 },
    });
    expect(await database.get_all_items(project_path)).toEqual([
      expect.objectContaining({ dst: "你好", status: "PROCESSED" }),
    ]);
    expect(await database.get_rules(project_path, "glossary")).toEqual([
      expect.objectContaining({ entry_id: "HELLO", dst: "你好" }),
    ]);
    expect((await database.read_asset_content(project_path, "text.txt"))?.toString()).toBe("Hello");
  } finally {
    await runtime.dispose();
    await planning.dispose();
    await database.close();
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
