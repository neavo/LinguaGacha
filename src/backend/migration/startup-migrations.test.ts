import type { LogManager } from "../log/log-manager";
import { AppPathService } from "../app/app-path-service";
import { expect, it } from "vitest";
import { run_startup_migrations } from "./startup-migrations";
import type { StartupMigration } from "./migration-types";
it("启动迁移按顺序等待异步步骤完成", async () => {
  const calls: string[] = [];
  const migrations: StartupMigration[] = [
    {
      id: "b",
      order: 2,
      run_startup: () => {
        calls.push("b");
      },
    },
    {
      id: "a",
      order: 1,
      run_startup: async () => {
        await Promise.resolve();
        calls.push("a");
      },
    },
  ];

  await run_startup_migrations(
    {
      paths: new AppPathService({
        appRoot: "E:/migration-fixture",
        builtinRoot: "E:/migration-fixture/builtin",
      }),
      log_manager: { warning(): void {} } as unknown as LogManager,
    },
    migrations,
  );

  expect(calls).toEqual(["a", "b"]);
});
