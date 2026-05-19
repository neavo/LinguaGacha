import { describe, expect, it } from "vitest";

import { CoreEventHub } from "./core-event-hub";

describe("CoreEventHub", () => {
  it("发布公开事件时同时通知进程内订阅者并保留 SSE 帧", async () => {
    const core_event_hub = new CoreEventHub();
    const local_events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const unsubscribe = core_event_hub.subscribe("task.snapshot_changed", (event) => {
      local_events.push(event);
    });
    const response = core_event_hub.create_stream_response();
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    core_event_hub.publish("task.snapshot_changed", {
      task: {
        task_type: "translation",
        status: "running",
      },
    });
    const chunk = await reader?.read();

    unsubscribe();
    await reader?.cancel();
    core_event_hub.stop();

    const frame = new TextDecoder().decode(chunk?.value);
    expect(local_events).toEqual([
      {
        type: "task.snapshot_changed",
        payload: {
          task: {
            task_type: "translation",
            status: "running",
          },
        },
      },
    ]);
    expect(frame).toContain("event: task.snapshot_changed");
    expect(frame).toContain('"status":"running"');
  });

  it("取消订阅后不再接收后续本地事件", () => {
    const core_event_hub = new CoreEventHub();
    const local_events: Array<Record<string, unknown>> = [];
    const unsubscribe = core_event_hub.subscribe("project.data_changed", (event) => {
      local_events.push(event.payload);
    });

    unsubscribe();
    core_event_hub.publish("project.data_changed", { source: "translation_reset" });
    core_event_hub.stop();

    expect(local_events).toEqual([]);
  });
});
