import { describe, expect, it } from "vitest";

import type { ApiJsonValue } from "../api/api-types";
import type { LogManager } from "../log/log-manager";
import type { ConfigService } from "../service/config-service";
import type { TaskDataService } from "../task/task-data-service";
import type { TaskEventHub } from "../task/task-event-hub";
import type { MutableJsonRecord } from "../task/task-types";
import type { TaskRuntimeState } from "../task/task-runtime-state";
import type { TaskSnapshotBuilder } from "../task/task-snapshot-builder";
import type { PythonTaskExecutorClient } from "./python-task-executor-client";
import { PythonTaskExecutorTransportError } from "./python-task-executor-client";
import { TaskEngine } from "./task-engine";

describe("TaskEngine", () => {
  it("翻译单条重试超限后把强制 ERROR 条目提交落库", async () => {
    const committed_batches: MutableJsonRecord[] = [];
    const done = create_status_waiter("translation", "DONE");
    const task_engine = new TaskEngine({
      taskDataService: {
        get_translation_items: () => ({
          items: [create_pending_item()] as unknown as ApiJsonValue,
          meta: {},
        }),
        commit_translation_batch: (request: MutableJsonRecord) => {
          committed_batches.push({ ...request });
          return { accepted: true };
        },
        update_translation_progress: () => ({ accepted: true }),
      } as unknown as TaskDataService,
      taskRuntimeState: {} as unknown as TaskRuntimeState,
      eventHub: {
        publish: done.publish,
        publish_project_patch: () => undefined,
      } as unknown as TaskEventHub,
      executorClient: {
        execute_translation_chunk: async () => ({
          items: [create_pending_item()],
          row_count: 0,
          input_tokens: 1,
          output_tokens: 2,
          stopped: false,
        }),
      } as unknown as PythonTaskExecutorClient,
      configService: create_config_service(),
      snapshotBuilder: {
        build_task_snapshot: async () => ({ task_type: "translation", status: "DONE" }),
      } as unknown as TaskSnapshotBuilder,
      logManager: create_log_manager(),
    });

    await task_engine.start_translation("NEW", null);
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

  it("executor 传输失败时只重试当前翻译 chunk 并继续提交成功结果", async () => {
    const committed_items: MutableJsonRecord[] = [];
    const done = create_status_waiter("translation", "DONE");
    const failed_once_ids = new Set<number>();
    const task_engine = new TaskEngine({
      taskDataService: {
        get_translation_items: () => ({
          items: [
            create_pending_item(1, "a.txt"),
            create_pending_item(2, "b.txt"),
          ] as unknown as ApiJsonValue,
          meta: {},
        }),
        commit_translation_batch: (request: MutableJsonRecord) => {
          const items = request["items"];
          if (Array.isArray(items)) {
            committed_items.push(...(items as MutableJsonRecord[]));
          }
          return { accepted: true };
        },
        update_translation_progress: () => ({ accepted: true }),
      } as unknown as TaskDataService,
      taskRuntimeState: {} as unknown as TaskRuntimeState,
      eventHub: {
        publish: done.publish,
        publish_project_patch: () => undefined,
      } as unknown as TaskEventHub,
      executorClient: {
        execute_translation_chunk: async (body: MutableJsonRecord) => {
          const items = (Array.isArray(body["items"]) ? body["items"] : []) as MutableJsonRecord[];
          const item_id = Number(items[0]?.["id"] ?? 0);
          if (item_id === 1 && !failed_once_ids.has(item_id)) {
            failed_once_ids.add(item_id);
            throw new PythonTaskExecutorTransportError(
              "fetch failed",
              new TypeError("fetch failed"),
            );
          }
          return {
            items: items.map((item) => ({
              ...item,
              dst: `译文${String(item["id"] ?? "")}`,
              status: "PROCESSED",
            })),
            row_count: items.length,
            input_tokens: 1,
            output_tokens: 1,
            stopped: false,
          };
        },
      } as unknown as PythonTaskExecutorClient,
      configService: create_config_service(2),
      snapshotBuilder: {
        build_task_snapshot: async () => ({ task_type: "translation", status: "DONE" }),
      } as unknown as TaskSnapshotBuilder,
      logManager: create_log_manager(),
    });

    await task_engine.start_translation("NEW", null);
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
        if (
          event_type === "task.status_changed" &&
          payload["task_type"] === task_type &&
          payload["status"] === status
        ) {
          resolve_waiter();
        }
      },
    };
  }

  function create_config_service(concurrency_limit = 1): ConfigService {
    const model = {
      id: "model-1",
      threshold: {
        concurrency_limit,
        input_token_limit: 512,
      },
    };
    return {
      load_config: () => ({
        activate_model_id: "model-1",
        models: [model],
      }),
    } as unknown as ConfigService;
  }

  function create_log_manager(): LogManager {
    return {
      error: () => undefined,
    } as unknown as LogManager;
  }
});
