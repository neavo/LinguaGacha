import type { BatchTranslationRunContext } from "./batch-translation-runner-options";
import { Model } from "../../../domain/model";
import { normalize_setting_snapshot } from "../../../domain/setting";
import { TextQualitySnapshotTool } from "../../../shared/text/text-types";
import {
  normalize_batch_translation_progress,
  type BatchTranslationProgress,
} from "../../../domain/batch-translation";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ProjectDataReader } from "../../project/project-data-reader";
import { ProjectSessionState } from "../../project/project-session-state";
import { RuntimeOperationGate } from "../../runtime-operation-gate";
import { BatchTranslationRuntime } from "../batch-translation-runtime";
import type { BatchTranslationStartCommand } from "../../../domain/batch-translation";
import type { BatchTranslationSnapshot } from "../../../domain/batch-translation";
import type { TranslationWorkUnit } from "../protocol/work-unit";
import type { WorkUnitExecutionResult } from "../protocol/work-unit-result";
import type { TranslationTokenCountInput } from "../planning/token-metric-cache";
import type { WorkUnitExecutor } from "../work-unit/work-unit-executor";
import { WorkUnitExecutorTransportError } from "../work-unit/work-unit-transport-error";
import { BatchTranslationRunner } from "./batch-translation-runner";
import type { BatchTranslationRunnerOptions } from "./batch-translation-runner-options";
import type { PlanningWorkerPool } from "../planning/planning-worker-pool";
import { TranslationPlanner } from "../planning/translation-planner";
import { log_error_from_message } from "../../../shared/error";
import { format_log_content_text } from "../../../shared/log";
import type { JsonRecord, MutableJsonRecord } from "../../../domain/json";

describe("BatchTranslationRunner", () => {
  const cleanup_paths: string[] = [];

  afterEach(() => {
    for (const cleanup_path of cleanup_paths.splice(0)) {
      fs.rmSync(cleanup_path, { force: true, recursive: true });
    }
  });

  it("翻译单条重试超限后提交 ERROR 且不回填原文", async () => {
    const committed_batches: MutableJsonRecord[] = [];
    const done = create_status_waiter("done");
    const task_runtime = create_task_runtime(done.listener);
    const task_engine = new BatchTranslationRunner({
      builtinRoot: path.join(process.cwd(), "builtin"),
      taskStore: create_task_store({
        get_translation_items: () => ({
          items: [create_pending_item()],
          progress: normalize_batch_translation_progress({}),
        }),
        commit_translation_items: async (
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

    await start_task(task_engine, task_runtime, { mode: "new", scope: { kind: "all" } });
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
    expect(committed_batches[0]?.["translation_extras"]).toMatchObject({
      line: 1,
      processed_line: 0,
      error_line: 1,
      total_input_tokens: 1,
      total_output_tokens: 2,
      total_tokens: 3,
    });
  });

  it("Runner 将指定模型传给规划器，并发布同源任务摘要", async () => {
    const model_ids: string[] = [];
    const done = create_status_waiter("done");
    const task_runtime = create_task_runtime(done.listener);
    const task_engine = new BatchTranslationRunner({
      builtinRoot: create_template_root(),
      taskStore: create_task_store(),
      taskRuntime: task_runtime,
      executorClient: create_unused_executor(),
      logManager: create_log_manager(),
      taskPlanner: {
        build_translation_contexts: async (_items, _config, model) => {
          model_ids.push(String(model.id));
          return [];
        },
        build_translation_retry_plan: async () => ({ retry_contexts: [], forced_error_items: [] }),
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
      { mode: "new", scope: { kind: "all" } },
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
      builtinRoot: path.join(process.cwd(), "builtin"),
      taskStore: create_task_store({
        acquire_project_lease: () => () => {
          lease_release_count += 1;
        },
        get_translation_items: () => ({
          items: [],
          progress: normalize_batch_translation_progress(
            {
              translation_extras,
            }.translation_extras,
          ),
        }),
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

    await start_task(task_engine, task_runtime, { mode: "new", scope: { kind: "all" } });
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
      builtinRoot: path.join(process.cwd(), "builtin"),
      taskStore: create_task_store({
        acquire_project_lease: () => () => {
          lease_release_count += 1;
          resolve_lease_release();
        },
        get_translation_items: () => ({
          items: [],
          progress: normalize_batch_translation_progress({}),
        }),
      }),
      taskRuntime: task_runtime,
      executorClient: create_unused_executor(),
      taskPlanner: create_test_task_planner(),
      logManager: create_log_manager(),
    });

    await start_task(task_engine, task_runtime, { mode: "new", scope: { kind: "all" } });
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

  it("executor 传输失败时只重试当前翻译 chunk 并继续提交成功结果", async () => {
    const committed_items: MutableJsonRecord[] = [];
    const done = create_status_waiter("done");
    const failed_once_ids = new Set<number>();
    const task_runtime = create_task_runtime(done.listener);
    const run_context = create_run_context(2);
    const task_engine = new BatchTranslationRunner({
      builtinRoot: path.join(process.cwd(), "builtin"),
      taskStore: create_task_store({
        get_translation_items: () => ({
          items: [create_pending_item(1, "a.txt"), create_pending_item(2, "b.txt")],
          progress: normalize_batch_translation_progress({}),
        }),
        commit_translation_items: async (items: MutableJsonRecord[]) => {
          committed_items.push(...items);
          return { changed_item_ids: [], section_revisions: {} };
        },
      }),
      taskRuntime: task_runtime,
      executorClient: {
        execute_unit: async (unit: TranslationWorkUnit) => {
          const payload =
            typeof unit["payload"] === "object" && unit["payload"] !== null
              ? (unit["payload"] as MutableJsonRecord)
              : {};
          const items = (
            Array.isArray(payload["items"]) ? payload["items"] : []
          ) as MutableJsonRecord[];
          const item_id = Number(items[0]?.["id"] ?? 0);
          if (item_id === 1 && !failed_once_ids.has(item_id)) {
            failed_once_ids.add(item_id);
            throw new WorkUnitExecutorTransportError(
              log_error_from_message("fetch failed"),
              new TypeError("fetch failed"),
            );
          }
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
      taskPlanner: create_test_task_planner(),
      logManager: create_log_manager(),
    });

    await start_task(
      task_engine,
      task_runtime,
      {
        mode: "new",
        scope: { kind: "all" },
      },
      run_context,
    );
    await done.promise;

    expect(committed_items).toHaveLength(2);
    expect(committed_items.map((item) => item["id"]).sort()).toEqual([1, 2]);
    expect(committed_items.every((item) => item["status"] === "PROCESSED")).toBe(true);
  });

  it("翻译切块使用注入 token 计数器而不是字符长度估算", async () => {
    const executed_batches: number[][] = []; // 记录 executor 可见的 chunk 分组，证明长文本仍可被 fake token 预算合并
    const done = create_status_waiter("done");
    const task_runtime = create_task_runtime(done.listener);
    const run_context = create_run_context(1, 16);
    const task_engine = new BatchTranslationRunner({
      builtinRoot: path.join(process.cwd(), "builtin"),
      taskStore: create_task_store({
        get_translation_items: () => ({
          items: [
            create_pending_item(1, "demo.txt", "很长的第一条原文".repeat(20)),
            create_pending_item(2, "demo.txt", "很长的第二条原文".repeat(20)),
          ],
          progress: normalize_batch_translation_progress({}),
        }),
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
        mode: "new",
        scope: { kind: "all" },
      },
      run_context,
    );
    await done.promise;

    expect(executed_batches).toEqual([[1, 2]]);
  });

  it("翻译任务启动时对齐旧实现打印主提示词", async () => {
    const builtin_root = create_template_root();
    const logs: string[] = [];
    const done = create_status_waiter("done");
    const task_runtime = create_task_runtime(done.listener);
    const run_context = create_run_context(1, 512, {
      prompt_enhancement_enable: false,
    });
    const task_engine = new BatchTranslationRunner({
      builtinRoot: builtin_root,
      taskStore: create_task_store({
        get_translation_items: () => ({
          items: [],
          progress: normalize_batch_translation_progress({}),
        }),
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
      builtinRoot: path.join(process.cwd(), "builtin"),
      taskStore: create_task_store({
        acquire_project_lease: () => () => {
          lease_release_count += 1;
        },
        get_translation_items: () => ({
          items: [create_pending_item()],
          progress: normalize_batch_translation_progress({}),
        }),
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

    await start_task(task_engine, task_runtime, { mode: "new", scope: { kind: "all" } });
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
    const handle = task_runtime.begin_standalone(command.scope);
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

      commit_translation_items: async () => ({ changed_item_ids: [], section_revisions: {} }),

      get_translation_items: () => ({
        items: [],
        progress: normalize_batch_translation_progress({}),
      }),
      get_translation_items_by_scope: () => ({
        items: [],
        progress: normalize_batch_translation_progress({}),
      }),

      update_translation_progress: () => ({ accepted: true }),
      ...overrides,
    };
  }

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
        count_items: async (items: TranslationTokenCountInput[]) =>
          items.map((item) => ({ cache_key: item.cache_key, token_count })),
      } as unknown as PlanningWorkerPool,
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

  function create_template_root(): string {
    const builtin_root = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-engine-"));
    cleanup_paths.push(builtin_root);
    write_template(builtin_root, "translation_prompt", "zh", {
      "prefix.txt": "翻译前缀",
      "base.txt": "翻译正文 {target_language}",
      "thinking.txt": "翻译思考",
      "suffix.txt": "翻译后缀",
    });
    write_template(builtin_root, "analysis_prompt", "zh", {
      "prefix.txt": "分析前缀",
      "base.txt": "分析正文 {target_language}",
      "thinking.txt": "分析思考",
      "suffix.txt": "分析后缀",
    });
    return builtin_root;
  }

  function write_template(
    builtin_root: string,
    task_dir_name: string,
    language: string,
    files: Record<string, string>,
  ): void {
    const template_dir = path.join(builtin_root, task_dir_name, "template", language);
    fs.mkdirSync(template_dir, { recursive: true });
    for (const [file_name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(template_dir, file_name), content, "utf-8");
    }
  }

  function create_log_manager(logs: string[] = []): BatchTranslationRunnerOptions["logManager"] {
    return {
      append: (payload) => {
        logs.push(format_log_content_text(payload.content));
        return null;
      },
      info: (message: string) => {
        logs.push(message);
      },
      warning: (message: string) => {
        logs.push(message);
      },
      error: () => undefined,
    };
  }
});
