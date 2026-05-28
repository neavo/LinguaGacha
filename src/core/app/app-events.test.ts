import { describe, expect, it } from "vitest";

import { create_project_opened_for_cache_event, create_project_unloaded_event } from "./app-events";

describe("app-events", () => {
  it("创建工程缓存热机事件时固定全量 section 并克隆 revision", () => {
    const section_revisions = { project: 1, items: 2 };

    const event = create_project_opened_for_cache_event({
      projectPath: "E:/Project/demo.lg",
      sectionRevisions: section_revisions,
    });
    section_revisions.items = 99;

    expect(event).toMatchObject({
      type: "project.opened_for_cache",
      projectPath: "E:/Project/demo.lg",
      source: "project_lifecycle",
      affectedSections: [
        "project",
        "files",
        "items",
        "quality",
        "prompts",
        "analysis",
        "proofreading",
      ],
      sectionRevisions: {
        project: 1,
        items: 2,
      },
    });
  });

  it("创建工程卸载事件时不继承旧 section revision", () => {
    expect(create_project_unloaded_event("E:/Project/demo.lg")).toEqual({
      type: "project.unloaded",
      projectPath: "E:/Project/demo.lg",
      source: "project_lifecycle",
      affectedSections: [],
      sectionRevisions: {},
    });
  });
});
