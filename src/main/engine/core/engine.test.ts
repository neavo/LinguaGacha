import { describe, expect, it } from "vitest";

import type { ApiJsonValue } from "../../api/api-types";
import type { LogManager } from "../../log/log-manager";
import type { SettingService } from "../../service/setting-service";
import type { MutableJsonRecord } from "../runtime/task-runtime-types";
import type { TaskRuntimePublisher } from "../runtime/task-runtime-publisher";
import type { ProjectTaskStore } from "../store/project-task-store";
import type { WorkerExecutor } from "../worker/worker-executor";
import { WorkUnitExecutorTransportError } from "../worker/worker-transport-error";
import { TaskEngine } from "./engine";

describe("TaskEngine", () => {
  it("公开单条翻译也通过共享 limiter 排队", async () => {
    const first_response = create_deferred<MutableJsonRecord>();
    let executor_call_count = 0;
    const task_engine = new TaskEngine({
      taskStore: {
        build_quality_snapshot: () => null,
      } as unknown as ProjectTaskStore,
      taskRuntimePublisher: create_task_runtime_publisher(),
      executorClient: {
        translate_single: async () => {
          executor_call_count += 1;
          if (executor_call_count === 1) {
            return await first_response.promise;
          }
          return { text: "第二条" };
        },
      } as unknown as WorkerExecutor,
      SettingService: create_setting_service(1),
      logManager: create_log_manager(),
    });

    const first = task_engine.translate_single("第一条");
    await wait_until(() => executor_call_count === 1);
    const second = task_engine.translate_single("第二条");
    await Promise.resolve();
    await Promise.resolve();

    expect(executor_call_count).toBe(1);

    first_response.resolve({ text: "第一条", logs: [] });
    await expect(first).resolves.toEqual({ text: "第一条" });
    await expect(second).resolves.toEqual({ text: "第二条" });
    expect(executor_call_count).toBe(2);
  });

  it("翻译单条重试超限后把强制 ERROR 条目提交落库", async () => {
    const committed_batches: MutableJsonRecord[] = [];
    const done = create_status_waiter("translation", "done");
    const task_engine = new TaskEngine({
      taskStore: {
        get_translation_items: () => ({
          items: [create_pending_item()] as unknown as ApiJsonValue,
          meta: {},
        }),
        acquire_project_lease: () => () => undefined,
        commit_artifacts: (request: MutableJsonRecord) => {
          const artifacts = Array.isArray(request["artifacts"])
            ? (request["artifacts"] as MutableJsonRecord[])
            : [];
          const artifact = artifacts[0] ?? {};
          committed_batches.push({ ...request });
          committed_batches[committed_batches.length - 1] = {
            items: artifact["items"],
            translation_extras: request["progress_snapshot"],
          };
          return { accepted: true };
        },
        update_translation_progress: () => ({ accepted: true }),
        build_quality_snapshot: () => null,
      } as unknown as ProjectTaskStore,
      taskRuntimePublisher: create_task_runtime_publisher(done.publish),
      executorClient: {
        execute_unit: async () =>
          create_translation_worker_result([create_pending_item()], 0, 1, 2),
      } as unknown as WorkerExecutor,
      SettingService: create_setting_service(),
      logManager: create_log_manager(),
    });

    await task_engine.start({
      task_type: "translation",
      mode: "new",
      scope: { kind: "all" },
      expected_section_revisions: {},
    });
    await done.promise;

    expect(committed_batches).toHaveLength(1);
    expect(committed_batches[0]?.["items"]).toEqual([
      {
        id: 1,
        src: "原文",
        dst: "原文",
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

  it("翻译启动后首次进度快照使用本轮初始进度而不是旧 meta", async () => {
    let translation_extras: MutableJsonRecord = {
      line: 8,
      total_line: 8,
      processed_line: 8,
      total_tokens: 40,
    };
    let lease_release_count = 0;
    const progress_snapshots: MutableJsonRecord[] = [];
    const done = create_status_waiter("translation", "done");
    const task_engine = new TaskEngine({
      taskStore: {
        acquire_project_lease: () => () => {
          lease_release_count += 1;
        },
        get_translation_items: () => ({
          items: [] as unknown as ApiJsonValue,
          meta: {
            translation_extras,
          },
        }),
        update_translation_progress: (request: MutableJsonRecord) => {
          translation_extras = { ...(request["translation_extras"] as MutableJsonRecord) };
          return { accepted: true };
        },
        build_quality_snapshot: () => null,
      } as unknown as ProjectTaskStore,
      taskRuntimePublisher: create_task_runtime_publisher(done.publish, (task_type) => {
        progress_snapshots.push({
          task_type,
          ...translation_extras,
        });
      }),
      executorClient: {} as unknown as WorkerExecutor,
      SettingService: create_setting_service(),
      logManager: create_log_manager(),
    });

    await task_engine.start({
      task_type: "translation",
      mode: "new",
      scope: { kind: "all" },
      expected_section_revisions: {},
    });
    await done.promise;
    await wait_until(() => lease_release_count === 1);

    expect(progress_snapshots[0]).toMatchObject({
      task_type: "translation",
      line: 0,
      total_line: 0,
      processed_line: 0,
      total_tokens: 0,
    });
  });

  it("executor 传输失败时只重试当前翻译 chunk 并继续提交成功结果", async () => {
    const committed_items: MutableJsonRecord[] = [];
    const done = create_status_waiter("translation", "done");
    const failed_once_ids = new Set<number>();
    const task_engine = new TaskEngine({
      taskStore: {
        get_translation_items: () => ({
          items: [
            create_pending_item(1, "a.txt"),
            create_pending_item(2, "b.txt"),
          ] as unknown as ApiJsonValue,
          meta: {},
        }),
        acquire_project_lease: () => () => undefined,
        commit_artifacts: (request: MutableJsonRecord) => {
          const artifacts = Array.isArray(request["artifacts"])
            ? (request["artifacts"] as MutableJsonRecord[])
            : [];
          const items = artifacts[0]?.["items"];
          if (Array.isArray(items)) {
            committed_items.push(...(items as MutableJsonRecord[]));
          }
          return { accepted: true };
        },
        update_translation_progress: () => ({ accepted: true }),
        build_quality_snapshot: () => null,
      } as unknown as ProjectTaskStore,
      taskRuntimePublisher: create_task_runtime_publisher(done.publish),
      executorClient: {
        execute_unit: async (unit: MutableJsonRecord) => {
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
            throw new WorkUnitExecutorTransportError("fetch failed", new TypeError("fetch failed"));
          }
          return create_translation_worker_result(
            items.map((item) => ({
              ...item,
              dst: `译文${String(item["id"] ?? "")}`,
              status: "PROCESSED",
            })),
            items.length,
            1,
            1,
          );
        },
      } as unknown as WorkerExecutor,
      SettingService: create_setting_service(2),
      logManager: create_log_manager(),
    });

    await task_engine.start({
      task_type: "translation",
      mode: "new",
      scope: { kind: "all" },
      expected_section_revisions: {},
    });
    await done.promise;

    expect(committed_items).toHaveLength(2);
    expect(committed_items.map((item) => item["id"]).sort()).toEqual([1, 2]);
    expect(committed_items.every((item) => item["status"] === "PROCESSED")).toBe(true);
  });

  function create_pending_item(id = 1, file_path = "demo.txt"): MutableJsonRecord {
    return {
      id,
      src: "原文",
      dst: "",
      status: "NONE",
      file_path,
    };
  }

  function create_translation_worker_result(
    items: MutableJsonRecord[],
    row_count: number,
    input_tokens: number,
    output_tokens: number,
  ): MutableJsonRecord {
    return {
      unit_id: "unit-1",
      kind: "translation",
      outcome: row_count > 0 ? "success" : "failed",
      metrics: { input_tokens, output_tokens },
      output: {
        kind: "translation",
        items: items as unknown as ApiJsonValue,
        row_count,
      },
      logs: [],
    };
  }

  function create_status_waiter(
    task_type: string,
    status: string,
  ): {
    promise: Promise<void>;
    publish: (event_type: string, payload: MutableJsonRecord) => void;
  } {
    let resolve_waiter: () => void = () => undefined;
    const promise = new Promise<void>((resolve) => {
      resolve_waiter = resolve;
    });
    return {
      promise,
      publish: (event_type, payload) => {
        if (event_type === "task.snapshot_changed") {
          const task = payload["task"] as MutableJsonRecord | undefined;
          if (task?.["task_type"] === task_type && task["status"] === status) {
            resolve_waiter();
          }
        } else if (payload["task_type"] === task_type && payload["status"] === status) {
          resolve_waiter();
        }
      },
    };
  }

  function create_task_runtime_publisher(
    on_publish: (event_type: string, payload: MutableJsonRecord) => void = () => undefined,
    on_progress_committed: (task_type: string) => void = () => undefined,
  ): TaskRuntimePublisher {
    return {
      publish_status: async (task_type: string, status: string, busy: boolean) => {
        on_publish("task.snapshot_changed", {
          task: { task_type, status, busy } as unknown as ApiJsonValue,
        });
      },
      publish_progress_committed: async (task_type: string) => {
        on_progress_committed(task_type);
      },
      publish_request_pressure: () => undefined,
      flush_request_pressure: async () => undefined,
    } as unknown as TaskRuntimePublisher;
  }

  function create_deferred<T>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
  } {
    let resolve_deferred: (value: T) => void = () => undefined;
    const promise = new Promise<T>((resolve) => {
      resolve_deferred = resolve;
    });
    return { promise, resolve: resolve_deferred };
  }

  async function wait_until(predicate: () => boolean): Promise<void> {
    for (let index = 0; index < 10; index += 1) {
      if (predicate()) {
        return;
      }
      await Promise.resolve();
    }
    expect(predicate()).toBe(true);
  }

  function create_setting_service(concurrency_limit = 1): SettingService {
    const model = {
      id: "model-1",
      threshold: {
        concurrency_limit,
        input_token_limit: 512,
      },
    };
    return {
      load_setting: () => ({
        activate_model_id: "model-1",
        models: [model],
      }),
    } as unknown as SettingService;
  }

  function create_log_manager(): LogManager {
    return {
      error: () => undefined,
    } as unknown as LogManager;
  }
});
