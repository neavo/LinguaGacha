import { describe, expect, it } from "vitest";

import { MIGRATIONS, PROJECT_DATABASE_WRITEBACK_MIGRATION_IDS } from "./migration-registry";

describe("migration-registry", () => {
  it("注册全部当前迁移并按执行顺序导出写回迁移 ID", () => {
    expect(MIGRATIONS.map((migration) => migration.id)).toEqual([
      "legacy-default-config",
      "prompt-user-preset-layout",
      "quality-rule-preset-layout",
      "model-selection",
      "project-schema",
      "project-rule-storage",
      "project-item-stable-metadata",
      "trans-item-metadata",
      "project-item-public-contract",
      "analysis-checkpoint-status",
      "text-preserve-mode",
      "quality-default-meta",
      "translation-prompt-legacy-slot",
      "epub-ruby-block-text",
    ]);
    expect(PROJECT_DATABASE_WRITEBACK_MIGRATION_IDS).toEqual([
      "project-rule-storage",
      "project-item-stable-metadata",
      "trans-item-metadata",
      "project-item-public-contract",
      "analysis-checkpoint-status",
    ]);
  });
});
