import { create_text_resolver } from "../../shared/i18n";
import { BatchTaskRuntime } from "../batch-task/batch-task-runtime";
import { BatchRequestPool } from "../batch-task/batch-request-pool";
import { create_item } from "../../domain/item";
import { ProjectDataReader } from "../project/project-data-reader";
import { Model } from "../../domain/model";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ProjectDatabase } from "../database/database-operations";
import { ProjectWriteStore } from "../project/project-write-store";
import { ProjectCache } from "../cache/project-cache";
import { BatchTranslationProjectStore } from "./batch-translation-project-store";
import { TranslationPlanner } from "./planning/translation-planner";
import { PlanningWorkerPool } from "./planning/planning-worker-pool";
import { describe, expect, it, vi } from "vitest";
import { BatchTranslationService } from "./batch-translation-service";
import { ProjectOperationGate } from "../runtime-operation-gate";
import { BatchTranslationRunner } from "./core/batch-translation-runner";
import { DEFAULT_PROJECT_SETTINGS } from "../../domain/project-settings";

/** 组合真实任务服务与可控协作者，观察启动和停止命令。 */
function setup() {
  const project_path = "E:/Project/test.lg";
  const gate = new ProjectOperationGate();
  const tasks = new BatchTaskRuntime(project_path, gate);
  const runtime = tasks;
  const run = vi.fn<BatchTranslationRunner["run"]>(async () => "done");
  const append = vi.fn();
  const service = new BatchTranslationService(
    { run } as unknown as BatchTranslationRunner,
    runtime,
    {
      read_setting: () => ({
        models: [{ id: "translation" }],
        model_selection: { translation: "translation" },
      }),
    },
    { readBlock: () => DEFAULT_PROJECT_SETTINGS },
    { append },
  );
  return { service, runtime, gate, run, append, tasks };
}

describe("批量翻译服务", () => {
  it.each([false, true])("结束日志等待终态事件收尾，收尾失败：%s", async (fail) => {
    const { service, runtime, tasks, append } = setup();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    tasks.subscribe(async (_snapshot, [snapshot]) => {
      if (snapshot?.status !== "done") return;
      entered.resolve();
      await release.promise;
      if (fail) throw new Error("publication failed");
    });
    const handle = await service.start_current_project({
      operation: "translate",
      scope: { kind: "all" },
    });
    try {
      await entered.promise;
      expect(append).not.toHaveBeenCalled();
      release.resolve();
      if (fail) await expect(handle.completion).rejects.toThrow();
      else await expect(handle.completion).resolves.toMatchObject({ status: "done" });
      expect(append.mock.calls.at(-1)?.[0]).toMatchObject({
        level: "info",
        content: create_text_resolver("zh-CN")("app.log.batch_translation_ended"),
      });
      if (fail)
        expect(append.mock.calls[0]?.[0]).toMatchObject({
          level: "error",
          error: expect.anything(),
        });
    } finally {
      release.resolve();
      await runtime.dispose();
      await handle.completion.catch(() => undefined);
    }
  });

  it("普通入口拒绝已删除的失败参数", async () => {
    const { service, runtime, run } = setup();
    await expect(
      service.start({
        operation: "translate",
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
  it("Agent 使用本次条件并等待 completion", async () => {
    const { service, runtime, gate, run } = setup();
    let finish!: () => void;
    const work = new Promise<void>((resolve) => {
      finish = resolve;
    });
    run.mockImplementation(async () => {
      await work;
      return "done";
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
      item_ids: [2],
    });
    await expect(
      service.start({ operation: "translate", scope: { kind: "all" } }),
    ).rejects.toMatchObject({ code: "runtime.busy" });
    finish();
    expect((await result).status).toBe("done");
    expect(gate.get_snapshot().agent).toBe(true);
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
    expect(runtime.build_snapshot().tasks).toEqual([]);
    gate.finish_runtime(lease);
    await runtime.dispose();
  });
  it("工作台普通入口只选择待翻译条目", async () => {
    const { service, runtime, run } = setup();
    const handle = await service.start_current_project({
      operation: "translate",
      scope: { kind: "all" },
    });
    await handle.completion;
    expect(run.mock.calls[0]?.[1]).toEqual({ operation: "translate", item_statuses: ["NONE"] });
    await runtime.dispose();
  });
  it("普通项目写持有互斥时不能启动", async () => {
    const { service, runtime, gate } = setup();
    await gate.run_project_write(async () => {
      await expect(
        service.start({ operation: "translate", scope: { kind: "all" } }),
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
  await database.create_project(project_path);
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
  const gate = new ProjectOperationGate();
  const tasks = new BatchTaskRuntime(project_path, gate);
  const runtime = tasks;
  const settings = { read_setting: () => ({}) };
  const cache = new ProjectCache({
    projectPath: project_path,
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
    requestPool: new BatchRequestPool(),
    builtinRoot: path.join(process.cwd(), "builtin"),
    taskStore: new BatchTranslationProjectStore(project_path, cache, writes),
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
  const service = new BatchTranslationService(runner, runtime, settings, cache.settings, {
    append: vi.fn(),
  });
  const lease = gate.begin_runtime("agent");
  const model = Model.from_json({ id: "fake", threshold: { concurrency_limit: 1 } }, "fake");
  try {
    await cache.refresh();
    const frames: import("../../domain/batch-task").BatchTaskSnapshot[] = [];
    tasks.subscribe((_snapshot, changes) => {
      frames.push(...changes);
    });
    const result = await service.run_under_agent(
      lease,
      new AbortController().signal,
      model,
      request,
    );
    expect(frames[0]).toMatchObject({
      status: "requested",
      translation: { pending_item_ids: [] },
      progress: null,
    });
    const prepared = frames.find((frame) => frame.progress !== null);
    expect(prepared).toMatchObject({
      translation: { pending_item_ids: targets },
      progress: { total: targets.length, succeeded: 0 },
    });
    expect(frames.at(-1)).toMatchObject({
      status: "done",
      translation: { pending_item_ids: [] },
      progress: { total: targets.length, succeeded: targets.length },
    });
    expect(result).toMatchObject({
      status: "done",
      progress: { total: targets.length, succeeded: targets.length },
    });
    expect(result.progress?.output_tokens).toBeGreaterThan(0);
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
    await cache.refresh();
    execute_unit.mockClear();
    frames.length = 0;
    expect(
      await service.run_under_agent(lease, new AbortController().signal, model, {
        item_ids: [1, 2],
        item_statuses: ["NONE"],
      }),
    ).toMatchObject({
      status: "done",
      progress: { total: 0, succeeded: 0, output_tokens: 0, input_tokens: 0 },
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
    expect(frames.every((frame) => frame.translation?.pending_item_ids.length === 0)).toBe(true);
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
  await database.create_project(project_path);
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
    writer.add_asset(project_path, "text.txt", Buffer.from("Hello"), "TXT"),
  );
  const legacy_stats = { processed_line: 90, total_tokens: 500, time: 120 };
  await database.transaction(project_path, (writer) =>
    writer.set_meta(project_path, "translation_extras", legacy_stats),
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
  const cache = new ProjectCache({
    projectPath: project_path,
    database,
    logManager: { warning: vi.fn(), error: vi.fn() } as never,
    workerClient: { run: async () => ({}) } as never,
  });
  const writes = new ProjectWriteStore(database, vi.fn(), () => null);
  const runtime = new BatchTaskRuntime(project_path, new ProjectOperationGate());
  const planning = new PlanningWorkerPool({ execution: { kind: "in_process" } });
  try {
    await cache.refresh();

    expect(
      await database.read(project_path, (access) =>
        new ProjectDataReader(access).build_manifest(project_path),
      ),
    ).not.toHaveProperty("sectionRevisions.analysis");
    expect(cache.prompts.readBlock()).toHaveProperty(
      "translation.text",
      "Translate to {target_language}",
    );
    expect(cache.prompts.readBlock()).not.toHaveProperty("analysis");
    const runner = new BatchTranslationRunner({
      requestPool: new BatchRequestPool(),
      llmClient: {
        request: async () => {
          throw new Error("Unexpected LLM request");
        },
      },
      builtinRoot: path.join(process.cwd(), "builtin"),
      taskStore: new BatchTranslationProjectStore(project_path, cache, writes),
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
      {
        read_setting: () => ({
          model_selection: { translation: "fake" },
          models: [{ id: "fake", threshold: { concurrency_limit: 1 } }],
        }),
      },
      cache.settings,
      { append: vi.fn() },
    );
    const handle = await service.start_current_project({
      operation: "translate",
      scope: { kind: "all" },
    });
    expect(await handle.completion).toMatchObject({
      status: "done",
      progress: { total: 1, succeeded: 1, input_tokens: 4, reasoning_tokens: 1, output_tokens: 2 },
    });
    expect(await database.get_all_items(project_path)).toEqual([
      expect.objectContaining({ dst: "你好", status: "PROCESSED" }),
    ]);
    expect(await database.get_rules(project_path, "glossary")).toEqual([
      expect.objectContaining({ entry_id: "HELLO", dst: "你好" }),
    ]);
    expect((await database.read_asset_content(project_path, "text.txt"))?.toString()).toBe("Hello");
    expect((await database.get_all_meta(project_path))["translation_extras"]).toEqual(legacy_stats);
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
