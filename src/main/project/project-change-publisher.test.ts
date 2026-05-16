import { describe, expect, it } from "vitest";

import { CoreEventHub } from "../events/core-event-hub";
import type { ProjectChangeEventAdapter } from "./project-change-event-adapter";
import { ProjectChangePublisher } from "./project-change-publisher";

describe("ProjectChangePublisher", () => {
  it("把领域变更草稿适配后广播为 project.data_changed 事件", async () => {
    const core_event_hub = new CoreEventHub();
    const response = core_event_hub.create_stream_response();
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    const publisher = new ProjectChangePublisher(
      {
        adapt_project_change: (payload) => ({
          type: "project.changed",
          eventId: "evt-1",
          source: String(payload["source"] ?? ""),
          projectRevision: 2,
          sectionRevisions: { items: 2 },
          updatedSections: ["items"],
        }),
      } as ProjectChangeEventAdapter,
      core_event_hub,
    );

    publisher.publish_project_change({ source: "translation_reset" });
    const chunk = await reader?.read();
    await reader?.cancel();
    core_event_hub.stop();

    const frame = new TextDecoder().decode(chunk?.value);
    const event_line = frame.split("\n").find((line) => line.startsWith("event: "));
    const data_line = frame.split("\n").find((line) => line.startsWith("data: "));

    expect(event_line).toBe("event: project.data_changed");
    expect(JSON.parse(data_line?.slice("data: ".length) ?? "{}")).toEqual({
      type: "project.changed",
      eventId: "evt-1",
      source: "translation_reset",
      projectRevision: 2,
      sectionRevisions: { items: 2 },
      updatedSections: ["items"],
    });
  });
});
