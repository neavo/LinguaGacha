import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiStreamHub } from "../../api/api-stream-hub";
import {
  TaskRuntimePublisher,
  TASK_REQUEST_PRESSURE_PUBLISH_INTERVAL_MS,
} from "./task-runtime-publisher";
import { TaskRuntimeState } from "./task-runtime-state";
import type { TaskSnapshotBuilder } from "./task-snapshot-builder";
import type { JsonRecord, MutableJsonRecord } from "./task-runtime-types";

describe("TaskRuntimePublisher", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("生命周期状态立即发布完整 task.snapshot_changed", async () => {
    const published_messages: Array<{ topic: string; payload: MutableJsonRecord }> = [];
    const runtime_state = new TaskRuntimeState();
    const publisher = create_publisher(runtime_state, published_messages);

    await publisher.publish_status("translation", "running", true);

    expect(published_messages).toEqual([
      {
        topic: "task.snapshot_changed",
        payload: {
          task: {
            task_type: "translation",
            status: "running",
            busy: true,
            request_in_flight_count: 0,
            translation_scope: { kind: "all" },
          },
        },
      },
    ]);
  });

  it("request_in_flight_count-only 变化最多按 500ms 发布一次", async () => {
    vi.useFakeTimers();
    const published_messages: Array<{ topic: string; payload: MutableJsonRecord }> = [];
    const runtime_state = new TaskRuntimeState();
    runtime_state.begin_task("analysis");
    const publisher = create_publisher(runtime_state, published_messages);

    publisher.publish_request_pressure("analysis", 1);
    publisher.publish_request_pressure("analysis", 2);
    await Promise.resolve();

    expect(published_messages).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(TASK_REQUEST_PRESSURE_PUBLISH_INTERVAL_MS);

    expect(published_messages).toHaveLength(1);
    expect(published_messages[0]?.payload["task"]).toMatchObject({
      task_type: "analysis",
      request_in_flight_count: 2,
    });
  });

  it("终态发布前会先冲刷 pending request pressure", async () => {
    vi.useFakeTimers();
    const published_messages: Array<{ topic: string; payload: MutableJsonRecord }> = [];
    const runtime_state = new TaskRuntimeState();
    runtime_state.begin_task("translation");
    const publisher = create_publisher(runtime_state, published_messages);

    publisher.publish_request_pressure("translation", 3);
    await publisher.publish_status("translation", "done", false);

    expect(published_messages.map((entry) => entry.payload["task"])).toEqual([
      {
        task_type: "translation",
        status: "requested",
        busy: true,
        request_in_flight_count: 3,
        translation_scope: { kind: "all" },
      },
      {
        task_type: "translation",
        status: "done",
        busy: false,
        request_in_flight_count: 0,
        translation_scope: { kind: "all" },
      },
    ]);
  });

  function create_publisher(
    runtime_state: TaskRuntimeState,
    published_messages: Array<{ topic: string; payload: MutableJsonRecord }>,
  ): TaskRuntimePublisher {
    const api_stream_hub = {
      publish: (topic: string, payload: MutableJsonRecord) => {
        published_messages.push({ topic, payload });
      },
    } as unknown as ApiStreamHub;
    const snapshot_builder = {
      build_task_snapshot: async (request: JsonRecord) => {
        const snapshot = runtime_state.snapshot();
        return {
          task_type: String(request["task_type"] ?? "translation"),
          status: snapshot.status,
          busy: snapshot.busy,
          request_in_flight_count: snapshot.request_in_flight_count,
          translation_scope: snapshot.translation_scope,
        };
      },
    } as unknown as TaskSnapshotBuilder;
    return new TaskRuntimePublisher(api_stream_hub, runtime_state, snapshot_builder);
  }
});
