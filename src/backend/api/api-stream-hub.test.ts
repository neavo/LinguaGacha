import { describe, expect, it } from "vitest";

import { ApiStreamHub } from "./api-stream-hub";

describe("ApiStreamHub", () => {
  it("把公开事件编码为 SSE 帧", async () => {
    const api_stream_hub = new ApiStreamHub();
    const response = api_stream_hub.create_stream_response();
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    api_stream_hub.publish("batch_translation.snapshot_changed", {
      task: {
        status: "running",
      },
    });
    const chunk = await reader?.read();

    await reader?.cancel();
    api_stream_hub.stop();

    const frame = new TextDecoder().decode(chunk?.value);
    expect(frame).toContain("event: batch_translation.snapshot_changed");
    expect(frame).toContain('"status":"running"');
  });
});
