import { beforeEach, describe, expect, it, vi } from "vitest";

describe("model catalog store", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.resetModules();
  });

  it("按后端实例与修订裁决迟到结果，重载会话不重复提示", async () => {
    const store = await import("./model-catalog-store");
    const older = { instance_id: "older", started_at: 100, revision: 1 };
    const newer = { instance_id: "newer", started_at: 200, revision: 1 };
    expect(store.apply_model_catalog_revision(older)).toBe(true);
    expect(store.apply_model_catalog_revision(older)).toBe(false);
    expect(store.apply_model_catalog_revision(newer)).toBe(true);
    expect(store.apply_model_catalog_revision({ ...older, revision: 2 })).toBe(false);
    expect(store.apply_model_catalog_revision({ ...newer, revision: 0 })).toBe(false);

    vi.resetModules();
    const reloaded = await import("./model-catalog-store");
    expect(reloaded.apply_model_catalog_revision(newer)).toBe(false);
    expect(reloaded.apply_model_catalog_revision({ ...newer, revision: 2 })).toBe(true);
  });
});
