import { CacheManager } from "../../cache/cache-manager";
import { ProjectDatabase } from "../../database/database-operations";
import { ProjectWriteStore } from "../../project/project-write-store";
import { BatchTranslationProjectStore } from "../batch-translation-project-store";
import type { ComputeWorkerClient } from "../../worker/compute-worker-client";
import { Item } from "../../../domain/item";
import { TASK_PIPELINE_COMMIT_INTERVAL_MS } from "./translation-pipeline";
import { TranslationWorkerPool } from "../work-unit/translation-worker-pool";
import { log_error_from_message } from "../../../shared/error";
import type { BatchTranslationRunContext } from "./batch-translation-runner-options";
import { Model } from "../../../domain/model";
import { normalize_setting_snapshot } from "../../../domain/setting";
import { TextQualitySnapshotTool } from "../../../shared/text/text-types";
import { type BatchTranslationProgress } from "../../../domain/batch-translation";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { get_section_revision, ProjectDataReader } from "../../project/project-data-reader";
import { ProjectSessionState } from "../../project/project-session-state";
import { RuntimeOperationGate } from "../../runtime-operation-gate";
import { read_builtin_pi_models } from "../../llm/pi-model-catalog";
import { BatchTranslationRuntime } from "../batch-translation-runtime";
import type { BatchTranslationStartCommand } from "../../../domain/batch-translation";
import type { BatchTranslationSnapshot } from "../../../domain/batch-translation";
import type { TranslationWorkUnit } from "../protocol/work-unit";
import type { WorkUnitExecutionResult } from "../protocol/work-unit-result";
import type { WorkUnitExecutor } from "../work-unit/work-unit-executor";
import { BatchTranslationRunner } from "./batch-translation-runner";
import type { BatchTranslationRunnerOptions } from "./batch-translation-runner-options";
import { TranslationPlanner } from "../planning/translation-planner";
import { AppError } from "../../../shared/error";
import { format_log_content_text } from "../../../shared/log";
import type { JsonRecord, MutableJsonRecord } from "../../../domain/json";

describe("BatchTranslationRunner", () => {
  const cleanup_paths: string[] = [];

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const cleanup_path of cleanup_paths.splice(0)) {
      fs.rmSync(cleanup_path, { force: true, recursive: true });
    }
  });

  it("翻译单条重试超限后提交 ERROR 且不回填原文", async () => {
    const committed_batches: MutableJsonRecord[] = [];
    const done = create_status_waiter("done");
    const task_runtime = create_task_runtime(done.listener);
    const task_engine = new BatchTranslationRunner({
      catalog: { read_models: read_builtin_pi_models },
      llmClient: create_unused_llm_client(),
      builtinRoot: path.join(process.cwd(), "builtin"),
      taskStore: create_task_store({
        get_translation_items: () => [create_pending_item()],
        commit_translation_batch: async (
          items: MutableJsonRecord[],
          translation_extras: BatchTranslationProgress,
        ) => {
          committed_batches.push({ items, translation_extras });
          return { changed_item_ids: [], section_revisions: {} };
        },
      }),
      taskRuntime: task_runtime,
      executorClient: {
        execute_unit: async () => create_translation_worker_result([create_pending_item()], 1, 2),
      },
      taskPlanner: create_test_task_planner(),
      logManager: create_log_manager(),
    });

    await start_task(task_engine, task_runtime, {
      operation: "translate",
      mode: "new",
      scope: { kind: "all" },
    });
    await done.promise;

    expect(committed_batches).toHaveLength(1);
    expect(committed_batches[0]?.["items"]).toEqual([
      {
        id: 1,
        src: "原文",
        dst: "",
        status: "ERROR",
        file_path: "demo.txt",
      },
    ]);
    expect((await task_runtime.build_snapshot()).run_progress).toMatchObject({
      line: 1,
      processed_line: 0,
      error_line: 1,
    });
    expect(committed_batches[0]?.["translation_extras"]).toMatchObject({
      total_input_tokens: 4,
      total_output_tokens: 8,
      total_tokens: 12,
    });
  });

  it.each(["translate", "retranslate"] as const)(
    "%s 在仅用量落库后继续重试，同值结果也完成本轮目标",
    async (operation) => {
      const retranslate = operation === "retranslate";
      const builtin_root = create_template_root();
      const project_path = path.join(builtin_root, "task.lg");
      const database = new ProjectDatabase();
      database.create_project(project_path, "test");
      database.set_items(project_path, [
        Item.from_json({
          id: 1,
          src: "こんにちは",
          dst: retranslate ? "你好" : "",
          status: retranslate ? "PROCESSED" : "NONE",
          file_path: "demo.txt",
        }).to_json(),
      ]);
      const original_items = database.get_all_items(project_path);
      const session = new ProjectSessionState();
      session.mark_loaded(project_path);
      const reader = new ProjectDataReader(database);
      const runtime = new BatchTranslationRuntime(session, reader, new RuntimeOperationGate());
      const completed_scopes: number[][] = [];
      runtime.subscribe((snapshot) => {
        if (
          snapshot.status === "running" &&
          snapshot.scope.kind === "items" &&
          snapshot.run_progress?.line === 1
        )
          completed_scopes.push([...snapshot.scope.item_ids]);
      });
      const cache = new CacheManager({
        database,
        logManager: null,
        appSettingService: {
          read_setting: () => ({ source_language: "JA", target_language: "ZH" }),
        } as never,
        workerClient: { run: vi.fn(), dispose: vi.fn() } as unknown as ComputeWorkerClient,
      });
      const publish_change = vi.fn(() => null);
      const writes = new ProjectWriteStore(database, vi.fn(), publish_change);
      const store = new BatchTranslationProjectStore(database, session, cache, writes);
      const pool = new TranslationWorkerPool({
        builtinRoot: builtin_root,
        execution: { kind: "in_process" },
      });
      let release_retry = (): void => {};
      // 暂留重试结果，让空条目提交独立通过真实存储边界。
      const retry_response = new Promise<void>((resolve) => {
        release_retry = resolve;
      });
      let report_retry_started = (): void => {};
      const retry_started = new Promise<void>((resolve) => {
        report_retry_started = resolve;
      });
      let attempts = 0;
      try {
        await cache.warmProject(project_path);
        vi.useFakeTimers();
        const runner = new BatchTranslationRunner({
          catalog: { read_models: read_builtin_pi_models },
          builtinRoot: builtin_root,
          taskStore: store,
          taskRuntime: runtime,
          executorClient: pool,
          taskPlanner: create_test_task_planner(),
          logManager: create_log_manager(),
          llmClient: {
            request: async () => {
              const first = ++attempts === 1;
              if (!first) {
                report_retry_started();
                await retry_response;
              }
              return {
                response_think: "",
                response_result: first ? "无效响应" : '{"id":0,"text":"你好"}',
                input_tokens: first ? 10 : 20,
                reasoning_tokens: 0,
                output_tokens: first ? 5 : 7,
                cancelled: false,
                timeout: false,
              };
            },
          },
        });
        const command: BatchTranslationStartCommand = retranslate
          ? { operation: "retranslate", scope: { kind: "items", item_ids: [1] } }
          : { operation: "translate", mode: "new", scope: { kind: "all" } };
        const handle = runtime.begin_standalone(command.scope, command.operation);
        await runtime.execute(handle, () => runner.run(handle, command, create_run_context(4)));
        await retry_started;
        await vi.advanceTimersByTimeAsync(TASK_PIPELINE_COMMIT_INTERVAL_MS);
        expect(await runtime.build_snapshot()).toMatchObject({
          status: "running",
          run_progress: { line: 0, total_tokens: 15 },
          progress: { processed_line: retranslate ? 1 : 0, error_line: 0, total_tokens: 15 },
        });
        expect(database.get_all_items(project_path)).toEqual(original_items);
        expect(publish_change).not.toHaveBeenCalled();
        expect(get_section_revision(reader.get_all_meta(project_path), "items")).toBe(0);
        expect(get_section_revision(reader.get_all_meta(project_path), "proofreading")).toBe(0);
        if (retranslate)
          expect((await runtime.build_snapshot()).scope).toEqual({ kind: "items", item_ids: [1] });
        release_retry();
        expect(await handle.completion).toMatchObject({
          status: "done",
          progress: { processed_line: 1, error_line: 0, total_tokens: 42 },
          run_progress: { processed_line: 1, error_line: 0, total_tokens: 42 },
        });
        expect(attempts).toBe(2);
        expect(database.get_all_items(project_path)).toEqual([
          expect.objectContaining({ dst: "你好", status: "PROCESSED" }),
        ]);
        if (retranslate) {
          expect(completed_scopes).toContainEqual([]);
          expect(publish_change).not.toHaveBeenCalled();
        } else expect(publish_change).toHaveBeenCalledTimes(1);
      } finally {
        release_retry();
        await runtime.dispose();
        await pool.dispose();
        database.close();
      }
    },
  );

  it("Runner 将指定模型传给规划器，并发布同源任务摘要", async () => {
    const model_ids: string[] = [];
    const done = create_status_waiter("done");
    const task_runtime = create_task_runtime(done.listener);
    const task_engine = new BatchTranslationRunner({
      catalog: { read_models: read_builtin_pi_models },
      llmClient: create_unused_llm_client(),
      builtinRoot: create_template_root(),
      taskStore: create_task_store(),
      taskRuntime: task_runtime,
      executorClient: create_unused_executor(),
      logManager: create_log_manager(),
      taskPlanner: {
        build_translation_plan: async (_items, _config, model) => {
          model_ids.push(String(model.id));
          return { contexts: [], metrics: new Map() };
        },
        build_translation_retry_plan: () => ({ retry_contexts: [], forced_error_items: [] }),
      },
    });
    const run_context = {
      ...create_run_context(),
      model: {
        ...Model.from_json(
          { id: "chosen", name: "已选择接入点", model_id: "translation-model" },
          "chosen",
        ),
      },
    };
    await start_task(
      task_engine,
      task_runtime,
      { operation: "translate", mode: "new", scope: { kind: "all" } },
      run_context,
    );
    await done.promise;
    expect(model_ids).toEqual(["chosen"]);
    expect((await task_runtime.build_snapshot()).config).toMatchObject({
      model_name: "已选择接入点",
      model_id: "translation-model",
    });
  });

  it("翻译启动后首次进度快照使用本轮初始进度而不是旧 meta", async () => {
    let translation_extras: MutableJsonRecord = {
      line: 8,
      total_line: 8,
      processed_line: 8,
      total_tokens: 40,
    };
    let lease_release_count = 0;
    const progress_snapshots: MutableJsonRecord[] = [];
    const done = create_status_waiter("done");
    const task_runtime = create_task_runtime(done.listener, () => ({
      translation_extras,
    }));
    task_runtime.subscribe((snapshot) => {
      if (snapshot.status === "running") {
        progress_snapshots.push({
          ...snapshot.progress,
        });
      }
    });
    const task_engine = new BatchTranslationRunner({
      catalog: { read_models: read_builtin_pi_models },
      llmClient: create_unused_llm_client(),
      builtinRoot: path.join(process.cwd(), "builtin"),
      taskStore: create_task_store({
        acquire_project_lease: () => () => {
          lease_release_count += 1;
        },
        get_translation_items: () => [],
        update_translation_progress: (request: MutableJsonRecord) => {
          translation_extras = {
            ...(request as MutableJsonRecord),
          };
          return { accepted: true };
        },
      }),
      taskRuntime: task_runtime,
      executorClient: create_unused_executor(),
      taskPlanner: create_test_task_planner(),
      logManager: create_log_manager(),
    });

    await start_task(task_engine, task_runtime, {
      operation: "translate",
      mode: "new",
      scope: { kind: "all" },
    });
    await done.promise;

    expect(lease_release_count).toBe(1);
    expect(progress_snapshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          line: 0,
          total_line: 0,
          processed_line: 0,
          total_tokens: 0,
        }),
      ]),
    );
  });

  it("终态 listener 失败时仍释放任务锁和工程连接租约", async () => {
    let lease_release_count = 0;
    let resolve_lease_release = (): void => undefined;
    const lease_released = new Promise<void>((resolve) => {
      resolve_lease_release = resolve;
    });
    const task_runtime = create_task_runtime();
    task_runtime.subscribe((snapshot) => {
      if (snapshot.status === "done") {
        throw new Error("terminal listener failed");
      }
    });
    const task_engine = new BatchTranslationRunner({
      catalog: { read_models: read_builtin_pi_models },
      llmClient: create_unused_llm_client(),
      builtinRoot: path.join(process.cwd(), "builtin"),
      taskStore: create_task_store({
        acquire_project_lease: () => () => {
          lease_release_count += 1;
          resolve_lease_release();
        },
        get_translation_items: () => [],
      }),
      taskRuntime: task_runtime,
      executorClient: create_unused_executor(),
      taskPlanner: create_test_task_planner(),
      logManager: create_log_manager(),
    });

    await start_task(task_engine, task_runtime, {
      operation: "translate",
      mode: "new",
      scope: { kind: "all" },
    });
    await lease_released;
    await wait_until(
      async () =>
        !["requested", "running", "stopping"].includes(
          (await task_runtime.build_snapshot()).status,
        ),
    );

    expect(lease_release_count).toBe(1);
    await expect(task_runtime.build_snapshot()).resolves.toMatchObject({
      status: "done",
    });
    await task_runtime.dispose();
  });

  it("executor 基础设施失败终止任务且不进入内容切分", async () => {
    const finished = create_status_waiter("error");
    const runtime = create_task_runtime(finished.listener);
    const execute = vi.fn(async () => {
      throw new AppError("worker.failed");
    });
    const runner = new BatchTranslationRunner({
      catalog: { read_models: read_builtin_pi_models },
      llmClient: create_unused_llm_client(),
      builtinRoot: path.join(process.cwd(), "builtin"),
      taskStore: create_task_store({ get_translation_items: () => [create_pending_item()] }),
      taskRuntime: runtime,
      executorClient: { execute_unit: execute },
      taskPlanner: create_test_task_planner(),
      logManager: create_log_manager(),
    });
    await start_task(runner, runtime, {
      operation: "translate",
      mode: "new",
      scope: { kind: "all" },
    });
    await finished.promise;
    expect(execute).toHaveBeenCalledTimes(1);
    expect((await runtime.build_snapshot()).status).toBe("error");
  });

  it.each(["recover", "stop"] as const)(
    "持续网络故障保持原条目，随后 %s 正常收尾",
    async (action) => {
      vi.useFakeTimers();
      const builtin_root = create_template_root();
      const pool = new TranslationWorkerPool({
        builtinRoot: builtin_root,
        execution: { kind: "in_process" },
      });
      const finished = create_status_waiter(action === "recover" ? "done" : "stopped");
      const runtime = create_task_runtime(finished.listener);
      const committed: MutableJsonRecord[] = [];
      const items = [
        create_pending_item(1),
        create_pending_item(2, "demo.txt", ""),
        {
          ...create_pending_item(3, "next.txt"),
          status: "PROCESSED",
          dst: "已有译文",
          retry_count: 2,
        },
        { ...create_pending_item(4, "last.txt"), status: "ERROR", dst: "失败译文", retry_count: 3 },
      ];
      const original = structuredClone(items);
      const execute = vi.spyOn(pool, "execute_unit");
      let started!: () => void;
      const first_request = new Promise<void>((resolve) => {
        started = resolve;
      });
      let recovered = false;
      const request = vi.fn(async () => {
        started();
        return {
          response_result: recovered ? '{"id":0,"text":"译文"}' : "",
          response_think: "",
          input_tokens: 1,
          reasoning_tokens: 0,
          output_tokens: 0,
          cancelled: false,
          timeout: false,
          ...(recovered ? {} : { request_error: log_error_from_message("网络故障") }),
        };
      });
      const runner = new BatchTranslationRunner({
        catalog: { read_models: read_builtin_pi_models },
        llmClient: { request },
        builtinRoot: builtin_root,
        taskRuntime: runtime,
        executorClient: pool,
        taskPlanner: create_test_task_planner(),
        logManager: create_log_manager(),
        taskStore: create_task_store({
          get_translation_items: () => items,
          commit_translation_batch: async (items) => {
            committed.push(...items);
            return { changed_item_ids: [], section_revisions: {} };
          },
        }),
      });
      const base_context = create_run_context(1);
      const context = { ...base_context, model: { ...base_context.model, api_key: "A\nB" } };
      try {
        const command: BatchTranslationStartCommand = {
          operation: "retranslate",
          scope: { kind: "items", item_ids: [1, 2, 3, 4] },
        };
        const handle = runtime.begin_standalone(command.scope, command.operation);
        await runtime.execute(handle, () => runner.run(handle, command, context));
        await first_request;
        await vi.advanceTimersByTimeAsync(100_000);
        expect(request).toHaveBeenCalledTimes(6);
        expect(committed).toEqual([]);
        expect(items).toEqual(original);
        expect((await runtime.build_snapshot()).run_progress).toMatchObject({
          total_line: 4,
          line: 0,
          error_line: 0,
        });
        expect((await runtime.build_snapshot()).request_recovery).toMatchObject({
          retry_count: 4,
        });
        if (action === "recover") {
          recovered = true;
          await vi.advanceTimersByTimeAsync(10_000);
        } else {
          await runtime.request_stop();
        }
        await finished.promise;
        expect(await handle.completion).toMatchObject({
          status: action === "recover" ? "done" : "stopped",
        });
        if (action === "recover") {
          expect(committed.map((item) => [item.id, item.status])).toEqual([
            [1, "PROCESSED"],
            [2, "PROCESSED"],
            [3, "PROCESSED"],
            [4, "PROCESSED"],
          ]);
          expect((await runtime.build_snapshot()).run_progress).toMatchObject({
            line: 4,
            error_line: 0,
            total_input_tokens: 9,
          });
          expect(execute).toHaveBeenCalledTimes(3);
        } else {
          expect(committed).toEqual([]);
          expect(execute).toHaveBeenCalledTimes(1);
        }
        expect(await runtime.build_snapshot()).toMatchObject({
          request_in_flight_count: 0,
          request_recovery: null,
        });
        expect(vi.getTimerCount()).toBe(0);
        expect(items).toEqual(original);
      } finally {
        await runtime.dispose();
        await pool.dispose();
      }
    },
  );

  it("SakuraLLM 批量响应无法对应时缩段，单条换行变化仍能完成写回", async () => {
    const builtin_root = create_template_root();
    const pool = new TranslationWorkerPool({
      builtinRoot: builtin_root,
      execution: { kind: "in_process" },
    });
    const done = create_status_waiter("done");
    const runtime = create_task_runtime(done.listener);
    const committed: MutableJsonRecord[] = [];
    const prompts: string[] = [];
    const run_context = create_run_context(1, 32, { source_language: "JA", target_language: "ZH" });
    const responses = ["无法对应的合并译文", "甲的完整译文", "乙的译文"];
    try {
      const runner = new BatchTranslationRunner({
        catalog: { read_models: read_builtin_pi_models },
        builtinRoot: builtin_root,
        taskStore: create_task_store({
          get_translation_items: () => [
            create_pending_item(1, "demo.txt", "甲\n续行"),
            create_pending_item(2, "demo.txt", "乙"),
          ],
          commit_translation_batch: async (items) => {
            committed.push(...items);
            return {
              changed_item_ids: items.map((item) => Number(item.id)),
              section_revisions: {},
            };
          },
        }),
        taskRuntime: runtime,
        executorClient: pool,
        taskPlanner: create_test_task_planner(16),
        logManager: create_log_manager(),
        llmClient: {
          request: async (body) => {
            const response_result = responses[prompts.length] ?? "";
            prompts.push(String(body.messages[1]?.content ?? ""));
            return {
              response_think: "",
              response_result,
              input_tokens: 1,
              reasoning_tokens: 0,
              output_tokens: 1,
              cancelled: false,
              timeout: false,
            };
          },
        },
      });
      await start_task(
        runner,
        runtime,
        { operation: "translate", mode: "new", scope: { kind: "all" } },
        { ...run_context, model: { ...run_context.model, api_format: "SakuraLLM" } },
      );
      await done.promise;

      expect(prompts).toEqual([
        expect.stringMatching(/\n甲\n续行\n乙$/u),
        expect.stringMatching(/\n甲\n续行$/u),
        expect.stringMatching(/\n乙$/u),
      ]);
      expect(committed).toMatchObject([
        { id: 1, dst: "甲的完整译文", status: "PROCESSED" },
        { id: 2, dst: "乙的译文", status: "PROCESSED" },
      ]);
      expect((await runtime.build_snapshot()).run_progress).toMatchObject({
        line: 2,
        processed_line: 2,
        error_line: 0,
      });
    } finally {
      await runtime.dispose();
      await pool.dispose();
    }
  });

  it("翻译切块使用注入 token 计数器而不是字符长度估算", async () => {
    const executed_batches: number[][] = []; // 记录 executor 可见的 chunk 分组，证明长文本仍可被 fake token 预算合并
    const done = create_status_waiter("done");
    const task_runtime = create_task_runtime(done.listener);
    const run_context = create_run_context(1, 16);
    const task_engine = new BatchTranslationRunner({
      catalog: { read_models: read_builtin_pi_models },
      llmClient: create_unused_llm_client(),
      builtinRoot: path.join(process.cwd(), "builtin"),
      taskStore: create_task_store({
        get_translation_items: () => [
          create_pending_item(1, "demo.txt", "很长的第一条原文".repeat(20)),
          create_pending_item(2, "demo.txt", "很长的第二条原文".repeat(20)),
        ],
      }),
      taskRuntime: task_runtime,
      executorClient: {
        execute_unit: async (unit: TranslationWorkUnit) => {
          const payload = (
            typeof unit["payload"] === "object" && unit["payload"] !== null ? unit["payload"] : {}
          ) as MutableJsonRecord;
          const items = (
            Array.isArray(payload["items"]) ? payload["items"] : []
          ) as MutableJsonRecord[];
          executed_batches.push(items.map((item) => Number(item["id"] ?? 0)));
          return create_translation_worker_result(
            items.map((item) => ({
              ...item,
              dst: `译文${String(item["id"] ?? "")}`,
              status: "PROCESSED",
            })),
            1,
            1,
          );
        },
      },
      taskPlanner: create_test_task_planner(1),
      logManager: create_log_manager(),
    });

    await start_task(
      task_engine,
      task_runtime,
      {
        operation: "translate",
        mode: "new",
        scope: { kind: "all" },
      },
      run_context,
    );
    await done.promise;

    expect(executed_batches).toEqual([[1, 2]]);
  });

  it("翻译任务启动时按本轮配置打印主提示词", async () => {
    const builtin_root = create_template_root();
    const logs: string[] = [];
    const done = create_status_waiter("done");
    const task_runtime = create_task_runtime(done.listener);
    const run_context = create_run_context(1, 512, {
      prompt_enhancement_enable: false,
    });
    const task_engine = new BatchTranslationRunner({
      catalog: { read_models: read_builtin_pi_models },
      llmClient: create_unused_llm_client(),
      builtinRoot: builtin_root,
      taskStore: create_task_store({
        get_translation_items: () => [],
      }),
      taskRuntime: task_runtime,
      executorClient: create_unused_executor(),
      taskPlanner: create_test_task_planner(),
      logManager: create_log_manager(logs),
    });

    await start_task(
      task_engine,
      task_runtime,
      {
        operation: "translate",
        mode: "new",
        scope: { kind: "all" },
      },
      run_context,
    );
    await done.promise;

    expect(logs.join("\n")).toContain("翻译前缀\n翻译正文 中文\n\n翻译后缀");
    expect(logs.join("\n")).not.toContain("翻译思考");
  });

  it("关闭运行态会等待任务终态与项目 lease 释放", async () => {
    let release_execution: (result: WorkUnitExecutionResult) => void = () => undefined;
    let read_execution_aborted = (): boolean => false;
    let mark_execution_started: () => void = () => undefined;
    const execution_started = new Promise<void>((resolve) => {
      mark_execution_started = resolve;
    });
    const execution = new Promise<WorkUnitExecutionResult>((resolve) => {
      release_execution = resolve;
    });
    let lease_release_count = 0;
    const task_runtime = create_task_runtime();
    const task_engine = new BatchTranslationRunner({
      catalog: { read_models: read_builtin_pi_models },
      llmClient: create_unused_llm_client(),
      builtinRoot: path.join(process.cwd(), "builtin"),
      taskStore: create_task_store({
        acquire_project_lease: () => () => {
          lease_release_count += 1;
        },
        get_translation_items: () => [create_pending_item()],
      }),
      taskRuntime: task_runtime,
      executorClient: {
        execute_unit: async (_unit: TranslationWorkUnit, signal: AbortSignal) => {
          read_execution_aborted = () => signal.aborted;
          mark_execution_started();
          return await execution;
        },
      },
      taskPlanner: create_test_task_planner(),
      logManager: create_log_manager(),
    });

    await start_task(task_engine, task_runtime, {
      operation: "translate",
      mode: "new",
      scope: { kind: "all" },
    });
    await execution_started;

    let dispose_completed = false;
    const disposing = task_runtime.dispose().then(() => {
      dispose_completed = true;
    });
    await Promise.resolve();

    expect(read_execution_aborted()).toBe(true);
    expect(dispose_completed).toBe(false);
    expect(lease_release_count).toBe(0);

    release_execution(create_translation_worker_result([create_pending_item()], 1, 1));
    await disposing;

    expect(dispose_completed).toBe(true);
    expect(lease_release_count).toBe(1);
  });

  /**
   * 构造任务 item 快照，src 参数用于切块测试制造“字符很长但 token 计数很小”的场景
   */
  function create_pending_item(id = 1, file_path = "demo.txt", src = "原文"): MutableJsonRecord {
    return {
      id,
      src,
      dst: "",
      status: "NONE",
      file_path,
    };
  }

  /** 以条目处理状态生成 worker 结果，供 Runner 验证提交与重试。 */
  function create_translation_worker_result(
    items: MutableJsonRecord[],
    input_tokens: number,
    output_tokens: number,
  ): WorkUnitExecutionResult {
    return {
      unit_id: "unit-1",
      kind: "translation",
      outcome: items.some((item) => item["status"] === "PROCESSED") ? "success" : "failed",
      metrics: { input_tokens, reasoning_tokens: 0, output_tokens },
      output: {
        kind: "translation",
        items,
      },
      logs: [],
    };
  }

  /** 通过公开状态事件等待目标终态。 */
  function create_status_waiter(status: BatchTranslationSnapshot["status"]): {
    promise: Promise<void>;
    listener: (snapshot: Readonly<BatchTranslationSnapshot>) => void;
  } {
    let resolve_waiter: () => void = () => undefined;
    const promise = new Promise<void>((resolve) => {
      resolve_waiter = resolve;
    });
    return {
      promise,
      listener: (snapshot) => {
        if (snapshot.status === status) {
          resolve_waiter();
        }
      },
    };
  }

  /** 组合真实运行态与可控 meta，验证任务生命周期和租约释放。 */
  function create_task_runtime(
    listener: (snapshot: Readonly<BatchTranslationSnapshot>) => void = () => undefined,
    read_meta: (() => JsonRecord) | null = null,
  ): BatchTranslationRuntime {
    const session_state = new ProjectSessionState();
    if (read_meta !== null) {
      session_state.mark_loaded("E:/Project/batch-translation-runtime-test.lg");
    }
    const runtime = new BatchTranslationRuntime(
      session_state,
      {
        get_all_meta: () => read_meta?.() ?? {},
        get_section_revision: () => 0,
      } as unknown as ProjectDataReader,
      new RuntimeOperationGate(),
    );
    runtime.subscribe(listener);
    return runtime;
  }

  /** 通过真实运行态预约任务，默认使用独立的执行配置。 */
  async function start_task(
    task_engine: BatchTranslationRunner,
    task_runtime: BatchTranslationRuntime,
    command: BatchTranslationStartCommand,
    run_context: BatchTranslationRunContext = create_run_context(),
  ): Promise<void> {
    const handle = task_runtime.begin_standalone(command.scope, command.operation);
    await task_runtime.execute(handle, () => task_engine.run(handle, command, run_context));
  }

  /** 等待终态发布失败后的异步资源释放。 */
  async function wait_until(predicate: () => boolean | Promise<boolean>): Promise<void> {
    for (let index = 0; index < 10; index += 1) {
      if (await predicate()) {
        return;
      }
      await Promise.resolve();
    }
    expect(await predicate()).toBe(true);
  }

  /**
   * 提供 BatchTranslationRunner 必需的完整项目端口；用例只覆盖与目标分支相关的方法。
   */
  function create_task_store(
    overrides: Partial<BatchTranslationRunnerOptions["taskStore"]> = {},
  ): BatchTranslationRunnerOptions["taskStore"] {
    return {
      acquire_project_lease: () => () => undefined,
      build_quality_snapshot: () => TextQualitySnapshotTool.from_api_value({}),

      commit_translation_batch: async () => ({ changed_item_ids: [], section_revisions: {} }),

      get_translation_items: () => [],

      update_translation_progress: () => ({ accepted: true }),
      ...overrides,
    };
  }

  /** 使用 executor 替身的场景不应触达真实请求边界。 */
  function create_unused_llm_client(): BatchTranslationRunnerOptions["llmClient"] {
    return {
      request: async () => {
        throw new Error("本用例不应发送模型请求。");
      },
    };
  }

  /** 空任务场景一旦意外调度 worker 就立即失败。 */
  function create_unused_executor(): WorkUnitExecutor {
    return {
      execute_unit: async () => {
        throw new Error("本用例不应执行 work unit。");
      },
    };
  }

  /**
   * 注入稳定 planning worker，隔离 tokenizer 细节后只验证 BatchTranslationRunner 是否消费规划边界。
   */
  function create_test_task_planner(token_count = 1): TranslationPlanner {
    return new TranslationPlanner({
      planningWorkerPool: {
        count_items: async (items: readonly string[]) => items.map(() => token_count),
      },
    });
  }

  /**
   * 构造模型阈值快照，input_token_limit 参数用于切块预算边界测试
   */
  function create_run_context(
    concurrency_limit = 1,
    input_token_limit = 512,
    setting_overrides: JsonRecord = {},
  ): BatchTranslationRunContext {
    const model = {
      id: "model-1",
      threshold: {
        concurrency_limit,
        input_token_limit,
      },
    };
    return {
      config_snapshot: normalize_setting_snapshot(setting_overrides),
      model: { ...Model.from_json(model, model.id) },
    };
  }

  /** 用临时翻译模板隔离启动日志的资源读取。 */
  function create_template_root(): string {
    const builtin_root = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-engine-"));
    cleanup_paths.push(builtin_root);
    const files = {
      "prefix.txt": "翻译前缀",
      "base.txt": "翻译正文 {target_language}",
      "thinking.txt": "翻译思考",
      "suffix.txt": "翻译后缀",
    };
    const template_dir = path.join(builtin_root, "translation_prompt", "template", "zh");
    fs.mkdirSync(template_dir, { recursive: true });
    for (const [file_name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(template_dir, file_name), content, "utf-8");
    }
    return builtin_root;
  }

  /** 收集结构化日志的公开文本投影。 */
  function create_log_manager(logs: string[] = []): BatchTranslationRunnerOptions["logManager"] {
    return {
      append: (payload) => {
        logs.push(format_log_content_text(payload.content));
        return null;
      },
    };
  }
});
