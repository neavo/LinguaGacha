import { Hono } from "hono";
import { register_post_json_route } from "./api-request";
import { adapt_project_change } from "../project/project-write-event-adapter";
import { ProjectSessionState } from "../project/project-session-state";
import { create_item, build_project_item_public_record } from "../../domain/item";
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

it("同一个提交事件通过 HTTP 与 SSE 编码为相同的轻量通知", async () => {
  const session = new ProjectSessionState();
  await session.mark_loaded("project.lg");
  const event = adapt_project_change(session, {
    projectPath: "project.lg",
    source: "unknown_writer",
    updatedSections: ["items"],
    sectionRevisions: { items: 2 },
    qualityStatisticsScope: "post_replacement",
    items: {
      mode: "delta",
      records: [
        build_project_item_public_record(create_item({ id: 1, src: "私有正文", dst: "译文" })),
      ],
    },
  })!;
  const hub = new ApiStreamHub();
  const reader = hub.create_stream_response().body!.getReader();
  try {
    const app = new Hono();
    register_post_json_route(
      app,
      "/write",
      () => ({ accepted: true, changes: [event] }),
      () => new Response(null, { status: 500 }),
    );
    const response = await app.request("/write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    hub.publish("project.data_changed", event);
    const chunk = await reader.read();
    const frame = new TextDecoder().decode(chunk.value);
    const data = frame
      .split("\n")
      .find((line) => line.startsWith("data: "))!
      .slice(6);
    const http = (await response.json()) as { data: { changes: unknown[] } };
    const stream_event: unknown = JSON.parse(data);
    expect(stream_event).toEqual(http.data.changes[0]);
    expect(stream_event).toMatchObject({
      items: { mode: "delta", changedIds: [1] },
      qualityStatisticsScope: "post_replacement",
    });
    expect(data).not.toContain("私有正文");
    expect(stream_event).not.toHaveProperty("sections");
  } finally {
    await reader.cancel();
    hub.stop();
  }
});
