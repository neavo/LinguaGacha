import type { ProjectDatabase } from "../database/database-operations";
import type { AppSettingService } from "../app/app-setting-service";
import { expect, it, vi } from "vitest";
import { build_project_open_writes } from "./project-open-migrations";
import type { ProjectOpenMigration } from "./migration-types";
it("项目打开迁移按顺序合并写入", async () => {
  const calls: string[] = [];
  const migrations: ProjectOpenMigration[] = [
    {
      id: "second",
      order: 2,
      build_project_open_writes: () => [() => calls.push("second")],
    },
    {
      id: "first",
      order: 1,
      build_project_open_writes: () => [() => calls.push("first")],
    },
  ];

  const database = {} as ProjectDatabase;
  const writes = await build_project_open_writes(
    {
      project_path: "demo.lg",
      database,
      app_setting_service: { read_setting: vi.fn() } as unknown as AppSettingService,
    },
    migrations,
  );
  for (const write of writes) {
    write(database);
  }

  expect(calls).toEqual(["first", "second"]);
});
