import { DatabaseSync } from "node:sqlite";
import { zstdCompressSync } from "node:zlib";
import { expect, it } from "vitest";
import { JsonTool } from "../../shared/utils/json-tool";
import type { DatabaseWritebackMigration } from "./migration-types";
import {
  run_project_database_migrations,
  PROJECT_DATABASE_APPLIED_WRITEBACK_MIGRATIONS_META_KEY,
} from "./database-migrations";
/** 按持久化 JSON 读取迁移完成标记。 */
function read_meta(db: DatabaseSync, key: string): unknown {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
  return row === undefined ? null : JsonTool.parseStrict(String(row["value"]));
}

it("按顺序建库和写回，失败原子回滚，重试及重复打开保留完成记录", () => {
  using db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE records (name TEXT)");
  const failure = new Error("writeback failed");
  let fail = true;
  const migrations: DatabaseWritebackMigration[] = [
    {
      id: "first",
      run: (db) => {
        db.prepare("INSERT INTO records VALUES (?)").run("first");
      },
    },
    {
      id: "second",
      run: (db) => {
        db.prepare("INSERT INTO records VALUES (?)").run("second");
        if (fail) throw failure;
      },
    },
  ];
  expect(() => run_project_database_migrations(db, migrations)).toThrow(failure);
  expect(db.prepare("SELECT name FROM records").all()).toEqual([{ name: "first" }]);
  expect(read_meta(db, PROJECT_DATABASE_APPLIED_WRITEBACK_MIGRATIONS_META_KEY)).toEqual(["first"]);
  fail = false;
  run_project_database_migrations(db, migrations);
  run_project_database_migrations(db, migrations);
  expect(db.prepare("SELECT name FROM records").all()).toEqual([
    { name: "first" },
    { name: "second" },
  ]);
  expect(read_meta(db, PROJECT_DATABASE_APPLIED_WRITEBACK_MIGRATIONS_META_KEY)).toEqual([
    "first",
    "second",
  ]);
});

it.each([false, true])("真实旧工程完整升级及早期步骤已完成：%s", (partial) => {
  using db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE items (id INTEGER PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE rules (id INTEGER PRIMARY KEY, type TEXT, data TEXT);
    CREATE TABLE assets (id INTEGER PRIMARY KEY, path TEXT UNIQUE, data BLOB, original_size INTEGER, compressed_size INTEGER);
  `);
  const original = Buffer.from(
    JSON.stringify({
      project: {
        files: {
          first: { data: [["first"], ["second"]] },
          next: { data: [["原文"]] },
        },
      },
    }),
  );
  const compressed = zstdCompressSync(original);
  db.prepare("INSERT INTO assets VALUES (1, ?, ?, ?, ?)").run(
    "story.TRANS",
    compressed,
    original.length,
    compressed.length,
  );
  const item = {
    src: "原文",
    dst: "译文",
    file_path: "story.TRANS",
    file_type: "TRANS",
    tag: "next",
    status: partial ? "PROCESSED" : "PROCESSED_IN_PAST",
    ...(partial ? { row: 2, text_type: "NONE", skip_internal_filter: true } : { row_number: "2" }),
    extra_field: {
      tag: ["aqua"],
      private: true,
      ...(partial ? { trans_ref: { file_key: "next", row_index: 0 } } : {}),
    },
    legacy_private: { keep: true },
  };
  db.prepare("INSERT INTO items VALUES (1, ?)").run(JSON.stringify(item));
  db.prepare("INSERT INTO items VALUES (2, ?)").run(
    JSON.stringify({ src: "# 旧正文", file_type: "MD", row: 0 }),
  );
  db.prepare("INSERT INTO items VALUES (3, ?)").run("broken-json");
  const early_ids = [
    "project-rule-storage",
    "quality-rule-entry-identity",
    "project-item-stable-metadata",
    "trans-item-metadata",
  ];
  if (partial)
    db.prepare("INSERT INTO meta VALUES (?, ?)").run(
      PROJECT_DATABASE_APPLIED_WRITEBACK_MIGRATIONS_META_KEY,
      JSON.stringify(early_ids),
    );

  run_project_database_migrations(db);

  const rows = db.prepare("SELECT data FROM items ORDER BY id").all();
  expect(JSON.parse(String(rows[0]!["data"]))).toMatchObject({
    src: "原文",
    dst: "译文",
    row: 2,
    status: "PROCESSED",
    skip_internal_filter: true,
    name_src: null,
    name_dst: null,
    extra_field: { tag: ["aqua"], private: true, trans_ref: { file_key: "next", row_index: 0 } },
    legacy_private: { keep: true },
  });
  expect(JSON.parse(String(rows[0]!["data"]))).not.toHaveProperty("row_number");
  expect(JSON.parse(String(rows[1]!["data"]))["file_type"]).toBe("MD");
  expect(rows[2]!["data"]).toBe("broken-json");
  expect(read_meta(db, PROJECT_DATABASE_APPLIED_WRITEBACK_MIGRATIONS_META_KEY)).toEqual([
    ...early_ids,
    "project-item-public-contract",
  ]);
  expect(db.prepare("SELECT sort_order FROM assets").get()?.["sort_order"]).toBe(0);
  const meta = db.prepare("SELECT * FROM meta ORDER BY key").all();
  run_project_database_migrations(db);
  expect(db.prepare("SELECT data FROM items ORDER BY id").all()).toEqual(rows);
  expect(db.prepare("SELECT * FROM meta ORDER BY key").all()).toEqual(meta);
});
