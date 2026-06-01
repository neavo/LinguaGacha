import { describe, expect, it } from "vitest";

import { quality_default_meta_migration } from "./quality-default-meta-migration";
import type { ProjectOpenMigrationContext } from "../migration-types";

describe("quality_default_meta_migration", () => {
  it("打开缺少术语表启用态的工程时物化领域默认值", () => {
    const context = create_context({});

    expect(quality_default_meta_migration.build_project_open_operations?.(context)).toEqual([
      {
        name: "setMeta",
        args: { projectPath: "demo.lg", key: "glossary_enable", value: true },
      },
    ]);
  });

  it("保留用户已经写入的术语表启用态", () => {
    const context = create_context({ glossary_enable: false });

    expect(quality_default_meta_migration.build_project_open_operations?.(context)).toEqual([]);
  });
});

function create_context(meta: Record<string, unknown>): ProjectOpenMigrationContext {
  return {
    project_path: "demo.lg",
    database: {
      execute: () => meta,
    },
  } as unknown as ProjectOpenMigrationContext;
}
