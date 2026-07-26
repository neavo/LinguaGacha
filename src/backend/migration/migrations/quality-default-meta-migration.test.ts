import { describe, expect, it, vi } from "vitest";

import { quality_default_meta_migration } from "./quality-default-meta-migration";
import type { ProjectOpenMigrationContext } from "../migration-types";

describe("quality_default_meta_migration", () => {
  it("打开缺少术语表启用态的工程时物化领域默认值", async () => {
    const context = create_context({});
    const writes =
      (await quality_default_meta_migration.build_project_open_writes?.(context)) ?? [];

    for (const write of writes) {
      write(context.database);
    }

    expect(context.database.set_meta).toHaveBeenCalledWith("demo.lg", "glossary_enable", true);
  });

  it("保留用户已经写入的术语表启用态", async () => {
    const context = create_context({ glossary_enable: false });

    expect(await quality_default_meta_migration.build_project_open_writes?.(context)).toEqual([]);
  });
});

function create_context(meta: Record<string, unknown>): ProjectOpenMigrationContext {
  return {
    project_path: "demo.lg",
    database: {
      get_all_meta: () => meta,
      set_meta: vi.fn(),
    },
  } as unknown as ProjectOpenMigrationContext;
}
