import { describe, expect, it } from "vitest";

import { ApiStreamHub } from "./api-stream-hub";

describe("ApiStreamHub", () => {
  it("发布公开 stream 消息时同时通知进程内订阅者并保留 SSE 帧", async () => {
    const api_stream_hub = new ApiStreamHub();
    const local_messages: Array<{ topic: string; payload: Record<string, unknown> }> = [];
    const unsubscribe = api_stream_hub.subscribe("task.snapshot_changed", (message) => {
      local_messages.push(message);
    });
    const response = api_stream_hub.create_stream_response();
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    api_stream_hub.publish("task.snapshot_changed", {
      task: {
        task_type: "translation",
        status: "running",
      },
    });
    const chunk = await reader?.read();

    unsubscribe();
    await reader?.cancel();
    api_stream_hub.stop();

    const frame = new TextDecoder().decode(chunk?.value);
    expect(local_messages).toEqual([
      {
        topic: "task.snapshot_changed",
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

  it("取消订阅后不再接收后续本地 stream 消息", () => {
    const api_stream_hub = new ApiStreamHub();
    const local_messages: Array<Record<string, unknown>> = [];
    const unsubscribe = api_stream_hub.subscribe("project.data_changed", (message) => {
      local_messages.push(message.payload);
    });

    unsubscribe();
    api_stream_hub.publish("project.data_changed", { source: "translation_reset" });
    api_stream_hub.stop();

    expect(local_messages).toEqual([]);
  });
});
