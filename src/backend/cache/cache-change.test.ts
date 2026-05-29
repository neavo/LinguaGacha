import { describe, expect, it } from "vitest";

import { create_cache_change } from "./cache-change";

describe("create_cache_change", () => {
  it("把 items canonical delta 归一成 cache item delta", () => {
    const change = create_cache_change({
      type: "project.items.changed",
      projectPath: "E:/Project/demo.lg",
      source: "translation_commit",
      affectedSections: ["items"],
      sectionRevisions: { items: 2 },
      items: {
        payloadMode: "canonical-delta",
        changedIds: [1, 2, 1, -1],
        deleteIds: [3],
      },
      scope: "items-partial",
    });

    expect(change).toMatchObject({
      fullRebuild: false,
      items: {
        mode: "delta",
        changedIds: [1, 2],
        deleteIds: [3],
        fieldPatch: null,
        sourcePayloadMode: "canonical-delta",
      },
      files: { mode: "keep" },
    });
  });

  it("缺少精确范围或文件变化时回落全量重建", () => {
    const missing_range = create_cache_change({
      type: "project.items.changed",
      projectPath: "E:/Project/demo.lg",
      source: "project_write",
      affectedSections: ["items"],
      sectionRevisions: { items: 2 },
      scope: "items-partial",
    });
    const files_changed = create_cache_change({
      type: "project.items.changed",
      projectPath: "E:/Project/demo.lg",
      source: "project_write",
      affectedSections: ["files"],
      sectionRevisions: { files: 2 },
      files: { payloadMode: "canonical-delta", changedPaths: ["script.txt"] },
      scope: "items-partial",
    });

    expect(missing_range).toMatchObject({
      fullRebuild: true,
      items: { mode: "full", reason: "missing-range" },
    });
    expect(files_changed).toMatchObject({
      fullRebuild: true,
      files: { mode: "full" },
    });
  });

  it("把 quality 和 settings 变化交给 view cache 自己失效", () => {
    const quality_change = create_cache_change({
      type: "project.quality.changed",
      projectPath: "E:/Project/demo.lg",
      source: "quality",
      affectedSections: ["quality"],
      sectionRevisions: { quality: 2 },
      scope: "quality-full",
    });
    const settings_change = create_cache_change({
      type: "project.settings.changed",
      projectPath: "E:/Project/demo.lg",
      source: "settings",
      affectedSections: ["project"],
      sectionRevisions: { project: 2 },
      changedKeys: ["target_language"],
    });

    expect(quality_change).toMatchObject({
      fullRebuild: false,
      quality: { mode: "full" },
      items: { mode: "keep" },
    });
    expect(settings_change).toMatchObject({
      fullRebuild: false,
      settings: { mode: "full" },
      items: { mode: "keep" },
    });
  });
});
