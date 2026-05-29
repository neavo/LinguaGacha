import { describe, expect, it } from "vitest";

import { normalize_project_change_event } from "@frontend/app/state/desktop-project-change-normalizer";

describe("desktop project change normalizer", () => {
  it("收窄合法 field-patch，并把 status 固定到 item 状态词表", () => {
    const event = normalize_project_change_event({
      eventId: "event-1",
      source: "proofreading_save_items",
      projectPath: "E:/demo/demo.lg",
      projectRevision: 2,
      updatedSections: ["items"],
      sectionRevisions: { items: 2 },
      items: {
        payloadMode: "field-patch",
        fieldPatch: {
          dst: "译文",
          status: "PROCESSED",
          retry_count: 2.8,
        },
        changedIds: [1, "1", 0, "bad"],
      },
    });

    expect(event?.operations[0]?.items).toEqual({
      payloadMode: "field-patch",
      fieldPatch: {
        dst: "译文",
        status: "PROCESSED",
        retry_count: 2,
      },
      changedIds: [1],
      deleteIds: [],
    });
  });

  it("坏 field-patch 退化为 section-invalidated，交给运行态补读 canonical items", () => {
    const event = normalize_project_change_event({
      eventId: "event-2",
      source: "project_data_changed",
      projectPath: "E:/demo/demo.lg",
      projectRevision: 3,
      updatedSections: ["items"],
      sectionRevisions: { items: 3 },
      items: {
        payloadMode: "field-patch",
        fieldPatch: {
          status: "BROKEN",
        },
        changedIds: [2],
      },
    });

    expect(event?.operations[0]?.items).toEqual({
      payloadMode: "section-invalidated",
      changedIds: [2],
      deleteIds: [],
    });
  });
});
