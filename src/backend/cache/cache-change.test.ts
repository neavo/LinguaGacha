import { expect, it } from "vitest";
import { create_cache_change } from "./cache-change";

it("按实际提交同时维护条目增量与质量、设置失效范围", () => {
  expect(
    create_cache_change({
      projectPath: "project.lg",
      source: "test",
      updatedSections: ["items", "quality", "project"],
      items: { payloadMode: "canonical-delta", changedIds: [1, 2], upsert: {} },
    }),
  ).toMatchObject({
    items: { mode: "delta", changedIds: [1, 2] },
    quality: { mode: "full" },
    settings: { mode: "full" },
  });
  expect(
    create_cache_change({ projectPath: "project.lg", source: "test", updatedSections: ["items"] })
      .items,
  ).toEqual({ mode: "full" });
  expect(
    create_cache_change({ projectPath: "project.lg", source: "test", updatedSections: ["files"] })
      .items,
  ).toEqual({ mode: "keep" });
});
