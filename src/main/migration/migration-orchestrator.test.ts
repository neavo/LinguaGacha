import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectDatabase } from "../database/database-operations";
import type { LogManager } from "../log/log-manager";
import { AppPathService } from "../app/app-path-service";
import type { AppSettingService } from "../app/app-setting-service";
import { JsonTool } from "../../shared/utils/json-tool";
import {
  PROJECT_DATABASE_APPLIED_WRITEBACK_MIGRATIONS_META_KEY,
  PROJECT_DATABASE_WRITEBACK_MIGRATION_IDS,
  MigrationOrchestrator,
  migration_orchestrator,
} from "./migration-orchestrator";

let temp_dir = "";
let databases: DatabaseSync[] = [];

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-orchestrator-"));
  databases = [];
});

afterEach(() => {
  for (const db of databases) {
    try {
      db.close();
    } catch {
      // 单个测试可能已经关闭句柄；收尾阶段只保证临时目录可清理
    }
  }
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

describe("MigrationOrchestrator", () => {
  it("启动期只执行带 startup hook 的迁移", () => {
    const calls: string[] = [];
    const orchestrator = new MigrationOrchestrator([
      { id: "b", order: 2, run_startup: () => calls.push("b") },
      { id: "a", order: 1, run_startup: () => calls.push("a") },
      { id: "db", order: 0, run_project_database_writeback: () => calls.push("db") },
    ]);

    orchestrator.run_startup_migrations({
      paths: new AppPathService({ appRoot: temp_dir }),
      log_manager: { warning(): void {} } as unknown as LogManager,
    });

    expect(calls).toEqual(["a", "b"]);
  });

  it("数据库写回迁移按 id 标记，已完成的迁移不会重复执行", () => {
    const db = open_database("writeback.lg");
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

  it("项目打开 hook 按顺序合并 operation", async () => {
    const orchestrator = new MigrationOrchestrator([
      {
        id: "second",
        order: 2,
        build_project_open_operations: () => [{ name: "second", args: {} }],
      },
      {
        id: "first",
        order: 1,
        build_project_open_operations: () => [{ name: "first", args: {} }],
      },
    ]);

    await expect(
      orchestrator.build_project_open_operations({
        project_path: "demo.lg",
        database: { execute: vi.fn() } as unknown as ProjectDatabase,
        app_setting_service: { read_setting: vi.fn() } as unknown as AppSettingService,
      }),
    ).resolves.toEqual([
      { name: "first", args: {} },
      { name: "second", args: {} },
    ]);
  });

  it("默认编排器写入当前写回迁移 id 集合", () => {
    const db = open_database("default.lg");

    migration_orchestrator.run_project_database_migrations(db);

    expect(read_meta(db, PROJECT_DATABASE_APPLIED_WRITEBACK_MIGRATIONS_META_KEY)).toEqual(
      PROJECT_DATABASE_WRITEBACK_MIGRATION_IDS,
    );
  });
});

/**
 * 编排器测试使用真实 SQLite 临时库，确保事务和 meta 标记行为可观察。
 */
function open_database(name: string): DatabaseSync {
  const db = new DatabaseSync(path.join(temp_dir, name));
  databases.push(db);
  return db;
}

/**
 * meta 值按 database workflow 的 JSON 形状读取，避免测试绕过持久格式。
 */
function read_meta(db: DatabaseSync, key: string): unknown {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
  return row === undefined ? null : JsonTool.parseStrict(String(row["value"]));
}
