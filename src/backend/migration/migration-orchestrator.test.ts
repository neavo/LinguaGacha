import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it, vi } from "vitest";

import type { ProjectDatabase } from "../database/database-operations";
import type { LogManager } from "../log/log-manager";
import { AppPathService } from "../app/app-path-service";
import type { AppSettingService } from "../app/app-setting-service";
import { JsonTool } from "../../shared/utils/json-tool";
import {
  PROJECT_DATABASE_APPLIED_WRITEBACK_MIGRATIONS_META_KEY,
  MigrationOrchestrator,
} from "./migration-orchestrator";

describe("MigrationOrchestrator", () => {
  it("启动期只执行带 startup hook 的迁移", () => {
    using temp_dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-orchestrator-"));
    const calls: string[] = [];
    const orchestrator = new MigrationOrchestrator([
      { id: "b", order: 2, run_startup: () => calls.push("b") },
      { id: "a", order: 1, run_startup: () => calls.push("a") },
      { id: "db", order: 0, run_project_database_writeback: () => calls.push("db") },
    ]);

    orchestrator.run_startup_migrations({
      paths: new AppPathService({
        appRoot: temp_dir.path,
        builtinRoot: path.join(temp_dir.path, "builtin"),
      }),
      log_manager: { warning(): void {} } as unknown as LogManager,
    });

    expect(calls).toEqual(["a", "b"]);
  });

  it("数据库写回迁移按 id 标记，已完成的迁移不会重复执行", () => {
    using temp_dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-orchestrator-"));
    using db = new DatabaseSync(path.join(temp_dir.path, "writeback.lg"));
    const calls: string[] = [];
    const orchestrator = new MigrationOrchestrator([
      {
        id: "schema",
        order: 1,
        run_project_database_schema: ({ db: current_db }) => {
          current_db.exec(
            "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
          );
        },
      },
      {
        id: "writeback",
        order: 2,
        run_project_database_writeback: () => calls.push("writeback"),
      },
    ]);

    orchestrator.run_project_database_migrations(db);
    orchestrator.run_project_database_migrations(db);

    expect(calls).toEqual(["writeback"]);
    expect(read_meta(db, PROJECT_DATABASE_APPLIED_WRITEBACK_MIGRATIONS_META_KEY)).toEqual([
      "writeback",
    ]);
  });

  it("项目打开 hook 按顺序合并写入", async () => {
    const calls: string[] = [];
    const orchestrator = new MigrationOrchestrator([
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
    ]);

    const database = {} as ProjectDatabase;
    const writes = await orchestrator.build_project_open_writes({
      project_path: "demo.lg",
      database,
      app_setting_service: { read_setting: vi.fn() } as unknown as AppSettingService,
    });
    for (const write of writes) {
      write(database);
    }

    expect(calls).toEqual(["first", "second"]);
  });
});

/**
 * meta 值按 database workflow 的 JSON 形状读取，避免测试绕过持久格式。
 */
function read_meta(db: DatabaseSync, key: string): unknown {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
  return row === undefined ? null : JsonTool.parseStrict(String(row["value"]));
}
