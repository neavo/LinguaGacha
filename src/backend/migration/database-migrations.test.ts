import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { JsonTool } from "../../shared/utils/json-tool";
import type { DatabaseSchemaMigration, DatabaseWritebackMigration } from "./migration-types";
import {
  run_project_database_migrations,
  PROJECT_DATABASE_APPLIED_WRITEBACK_MIGRATIONS_META_KEY,
  PROJECT_DATABASE_WRITEBACK_MIGRATION_IDS,
} from "./database-migrations";
/** 按持久化 JSON 读取迁移完成标记。 */
function read_meta(db: DatabaseSync, key: string): unknown {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
  return row === undefined ? null : JsonTool.parseStrict(String(row["value"]));
}

it("按顺序建库和写回，失败原子回滚，重试及重复打开保留完成记录", () => {
  using db = new DatabaseSync(":memory:");
  const schema: DatabaseSchemaMigration[] = [
    {
      id: "schema",
      order: 1,
      run_project_database_schema: ({ db }) =>
        db.exec(
          "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE IF NOT EXISTS records (name TEXT)",
        ),
    },
  ];
  const failure = new Error("writeback failed");
  let fail = true;
  const migrations: DatabaseWritebackMigration[] = [
    {
      id: "second",
      order: 2,
      run_project_database_writeback: ({ db }) => {
        db.prepare("INSERT INTO records VALUES (?)").run("second");
        if (fail) throw failure;
      },
    },
    {
      id: "first",
      order: 1,
      run_project_database_writeback: ({ db }) => {
        db.prepare("INSERT INTO records VALUES (?)").run("first");
      },
    },
  ];
  expect(() => run_project_database_migrations(db, schema, migrations)).toThrow(failure);
  expect(db.prepare("SELECT name FROM records").all()).toEqual([{ name: "first" }]);
  expect(read_meta(db, PROJECT_DATABASE_APPLIED_WRITEBACK_MIGRATIONS_META_KEY)).toEqual(["first"]);
  fail = false;
  run_project_database_migrations(db, schema, migrations);
  run_project_database_migrations(db, schema, migrations);
  expect(db.prepare("SELECT name FROM records").all()).toEqual([
    { name: "first" },
    { name: "second" },
  ]);
  expect(read_meta(db, PROJECT_DATABASE_APPLIED_WRITEBACK_MIGRATIONS_META_KEY)).toEqual([
    "first",
    "second",
  ]);
});

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
