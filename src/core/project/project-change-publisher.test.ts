import { describe, expect, it } from "vitest";

import { ApiStreamHub } from "../api/api-stream-hub";
import type { ProjectChangeEventAdapter } from "./project-change-event-adapter";
import { ProjectChangePublisher } from "./project-change-publisher";

describe("ProjectChangePublisher", () => {
  it("把领域变更草稿适配后广播为 project.data_changed 事件", async () => {
    const api_stream_hub = new ApiStreamHub();
    const response = api_stream_hub.create_stream_response();
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    const publisher = new ProjectChangePublisher(
      {
        adapt_project_change: (payload) => ({
          type: "project.changed",
          eventId: "evt-1",
          source: String(payload["source"] ?? ""),
          projectPath: String(payload["targetProjectPath"] ?? ""),
          projectRevision: 2,
          sectionRevisions: { items: 2 },
          updatedSections: ["items"],
        }),
      } as ProjectChangeEventAdapter,
      api_stream_hub,
    );

    publisher.publish_project_change({
      targetProjectPath: "E:/Project/demo.lg",
      source: "translation_reset",
    });
    const chunk = await reader?.read();
    await reader?.cancel();
    api_stream_hub.stop();

    const frame = new TextDecoder().decode(chunk?.value);
    const event_line = frame.split("\n").find((line) => line.startsWith("event: "));
    const data_line = frame.split("\n").find((line) => line.startsWith("data: "));

    expect(event_line).toBe("event: project.data_changed");
    expect(JSON.parse(data_line?.slice("data: ".length) ?? "{}")).toEqual({
      type: "project.changed",
      eventId: "evt-1",
      source: "translation_reset",
      projectPath: "E:/Project/demo.lg",
      projectRevision: 2,
      sectionRevisions: { items: 2 },
      updatedSections: ["items"],
    });
  });

  it("适配器判定无可广播事件时不写入事件流", async () => {
    const api_stream_hub = new ApiStreamHub();
    const publisher = new ProjectChangePublisher(
      {
        adapt_project_change: () => null,
      } as unknown as ProjectChangeEventAdapter,
      api_stream_hub,
    );

    const event = publisher.publish_project_change({
      targetProjectPath: "E:/Project/other.lg",
      source: "settings_alignment",
    });

    api_stream_hub.stop();
    expect(event).toBeNull();
  });
});
