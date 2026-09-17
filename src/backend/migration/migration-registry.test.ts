import { describe, expect, it } from "vitest";

import { PROJECT_DATABASE_WRITEBACK_MIGRATION_IDS } from "./migration-registry";

describe("migration-registry", () => {
  it("写回迁移标识及顺序保持持久化契约", () => {
    // 这些标识已写入历史工程，移除或改名会改变打开旧工程时的写回行为。
    expect(PROJECT_DATABASE_WRITEBACK_MIGRATION_IDS).toEqual([
      "project-rule-storage",
      "quality-rule-entry-identity",
      "project-item-stable-metadata",
      "trans-item-metadata",
      "project-item-public-contract",
    ]);
  });
});
