import { describe, expect, it } from "vitest";

import {
  isProjectDataSection,
  normalizeProjectChangePayloadMode,
  PROJECT_CHANGE_EVENT_TOPIC,
  PROJECT_DATA_SECTIONS,
} from "./project-event";

describe("project event contract", () => {
  it("公开稳定的项目 section 与事件 topic", () => {
    expect(PROJECT_DATA_SECTIONS).toEqual([
      "project",
      "files",
      "items",
      "quality",
      "prompts",
      "analysis",
      "proofreading",
    ]);
    expect(PROJECT_CHANGE_EVENT_TOPIC).toBe("project.data_changed");

    expect(isProjectDataSection("items")).toBe(true);
    expect(isProjectDataSection("task")).toBe(false);
  });

  it("未知 payload mode 降级为补读而不是误合并", () => {
    expect(normalizeProjectChangePayloadMode("canonical-delta")).toBe("canonical-delta");
    expect(normalizeProjectChangePayloadMode("field-patch")).toBe("field-patch");
    expect(normalizeProjectChangePayloadMode("bad-mode")).toBe("section-invalidated");
  });
});
