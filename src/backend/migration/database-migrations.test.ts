import { DatabaseSync } from "node:sqlite";
import { zstdCompressSync } from "node:zlib";
import { expect, it } from "vitest";
import { JsonTool } from "../../shared/utils/json-tool";
import type { DatabaseWritebackMigration } from "./migration-types";
import { run_renpy_rpy_file_type_migration } from "./database/renpy-rpy-file-type-migration";
import {
  run_project_database_migrations,
  PROJECT_DATABASE_APPLIED_WRITEBACK_MIGRATIONS_META_KEY,
} from "./database-migrations";
/** 按持久化 JSON 读取迁移完成标记。 */
function read_meta(db: DatabaseSync, key: string): unknown {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
  return row === undefined ? null : JsonTool.parseStrict(String(row["value"]));
}

it("Ren’Py 条目写入失败回滚资产、全部条目和标记，保留前项并支持重试", () => {
  using db = new DatabaseSync(":memory:");
  run_project_database_migrations(db, "1.0.0", []);
  // 第二条更新失败，使第一条已执行的更新也必须随资产改名一起回滚。
  db.exec(`
    CREATE TABLE records (name TEXT);
    INSERT INTO assets (path, file_type, data, original_size, compressed_size)
      VALUES ('script.rpy', 'RENPY', X'', 0, 0);
    CREATE TRIGGER reject_item BEFORE UPDATE ON items WHEN OLD.id = 2
      BEGIN SELECT RAISE(ABORT, 'item write failed'); END;
  `);
  const originals = [1, 2].map((id) => ({
    file_path: "script.rpy",
    src: `原文 ${id}`,
    dst: `译文 ${id}`,
    extra_field: { renpy: { v: 1, pair: { target_line: id } }, keep: true },
  }));
  const insert = db.prepare("INSERT INTO items VALUES (?, ?)");
  originals.forEach((item, index) => insert.run(index + 1, JSON.stringify(item)));
  const assets = db.prepare("SELECT * FROM assets").all();
  const items = db.prepare("SELECT * FROM items ORDER BY id").all();
  const migrations: DatabaseWritebackMigration[] = [
    {
      id: "first",
      run: (db) => {
        db.exec("INSERT INTO records VALUES ('first')");
      },
    },
    { id: "renpy-rpy-file-type", run: run_renpy_rpy_file_type_migration },
  ];
  const key = PROJECT_DATABASE_APPLIED_WRITEBACK_MIGRATIONS_META_KEY;

  expect(() => run_project_database_migrations(db, "1.0.0", migrations)).toThrow(
    "item write failed",
  );
  expect(db.prepare("SELECT * FROM assets").all()).toEqual(assets);
  expect(db.prepare("SELECT * FROM items ORDER BY id").all()).toEqual(items);
  expect(db.prepare("SELECT name FROM records").all()).toEqual([{ name: "first" }]);
  expect(read_meta(db, key)).toEqual(["first"]);

  db.exec("DROP TRIGGER reject_item");
  run_project_database_migrations(db, "1.0.0", migrations);
  expect(db.prepare("SELECT * FROM assets").all()).toEqual(
    assets.map((asset) => ({ ...asset, file_type: "RENPY_RPY" })),
  );
  expect(
    db
      .prepare("SELECT * FROM items ORDER BY id")
      .all()
      .map((row) => JSON.parse(String(row.data))),
  ).toEqual(
    originals.map((item) => ({
      ...item,
      extra_field: { renpy_rpy: item.extra_field.renpy, keep: true },
    })),
  );
  expect(read_meta(db, key)).toEqual(["first", "renpy-rpy-file-type"]);
});

it("早期迁移已完成的工程仍独立升级姓名字段", () => {
  using db = new DatabaseSync(":memory:");
  run_project_database_migrations(db, "1.0.0");
  const key = PROJECT_DATABASE_APPLIED_WRITEBACK_MIGRATIONS_META_KEY;
  const applied = read_meta(db, key) as string[];
  db.prepare("UPDATE meta SET value = ? WHERE key = ?").run(
    JSON.stringify(applied.filter((id) => id !== "item-name-text")),
    key,
  );
  const item = { name_src: ["Alice", "extra"], name_dst: ["译名"], unknown: { keep: true } };
  db.prepare("INSERT INTO items VALUES (1, ?)").run(JSON.stringify(item));

  run_project_database_migrations(db, "1.0.0");

  expect(JSON.parse(String(db.prepare("SELECT data FROM items WHERE id = 1").get()!.data))).toEqual(
    {
      ...item,
      name_src: "Alice",
      name_dst: "译名",
    },
  );
  expect(read_meta(db, key)).toEqual(applied);
});

it("版本维护失败回滚本项数据和迁移标记，保留前项已提交事实", () => {
  using db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE records (name TEXT)");
  expect(() =>
    run_project_database_migrations(db, "2.0.0", [
      {
        id: "first",
        run: (db) => {
          db.exec("INSERT INTO records VALUES ('first')");
        },
      },
      {
        id: "second",
        run: (db) => {
          db.exec(`
        INSERT INTO records VALUES ('second');
        UPDATE meta SET value = '"1.0.0"' WHERE key = 'target_app_version';
        CREATE TRIGGER reject_version BEFORE INSERT ON meta WHEN NEW.key = 'target_app_version'
          BEGIN SELECT RAISE(ABORT, 'version write failed'); END;
      `);
        },
      },
    ]),
  ).toThrow("version write failed");
  expect(db.prepare("SELECT name FROM records").all()).toEqual([{ name: "first" }]);
  expect(read_meta(db, "target_app_version")).toBe("2.0.0");
  expect(read_meta(db, PROJECT_DATABASE_APPLIED_WRITEBACK_MIGRATIONS_META_KEY)).toEqual(["first"]);
});

it("无数据迁移仍升级版本，结构事务失败时版本与结构一起回滚", () => {
  using db = new DatabaseSync(":memory:");
  run_project_database_migrations(db, "1.0.0", []);
  db.exec(`
    ALTER TABLE assets DROP COLUMN sort_order;
    CREATE TRIGGER reject_version BEFORE INSERT ON meta WHEN NEW.key = 'target_app_version'
      BEGIN SELECT RAISE(ABORT, 'version write failed'); END;
  `);
  expect(() => run_project_database_migrations(db, "2.0.0", [])).toThrow("version write failed");
  expect(read_meta(db, "target_app_version")).toBe("1.0.0");
  expect(
    db
      .prepare("PRAGMA table_info(assets)")
      .all()
      .some((row) => row.name === "sort_order"),
  ).toBe(false);
  db.exec("DROP TRIGGER reject_version");
  run_project_database_migrations(db, "2.0.0", []);
  expect(read_meta(db, "target_app_version")).toBe("2.0.0");
  expect(
    db
      .prepare("PRAGMA table_info(assets)")
      .all()
      .some((row) => row.name === "sort_order"),
  ).toBe(true);
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
  db.prepare("INSERT INTO assets VALUES (2, ?, ?, ?, ?)").run(
    "old.md",
    compressed,
    original.length,
    compressed.length,
  );
  const item = {
    src: "原文",
    dst: "译文",
    name_src: [123, "姓名", "附加信息"],
    name_dst: ["译名", "附加译名"],
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
    JSON.stringify({ src: "# 旧正文", file_path: "old.md", file_type: "MD", row: 0 }),
  );
  db.prepare("INSERT INTO items VALUES (3, ?)").run("broken-json");
  db.prepare("INSERT INTO assets VALUES (3, ?, ?, ?, ?)").run(
    "script.rpy",
    compressed,
    original.length,
    compressed.length,
  );
  db.prepare("INSERT INTO items VALUES (4, ?)").run(
    JSON.stringify({
      file_path: "script.rpy",
      file_type: "RENPY",
      dst: "译文",
      extra_field: { renpy: { v: 1 } },
    }),
  );
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

  run_project_database_migrations(db, "1.0.0");

  const rows = db.prepare("SELECT data FROM items ORDER BY id").all();
  expect(JSON.parse(String(rows[0]!["data"]))).toMatchObject({
    src: "原文",
    dst: "译文",
    row: 2,
    status: "PROCESSED",
    skip_internal_filter: true,
    name_src: "姓名",
    name_dst: "译名",
    extra_field: { tag: ["aqua"], private: true, trans_ref: { file_key: "next", row_index: 0 } },
    legacy_private: { keep: true },
  });
  expect(JSON.parse(String(rows[0]!["data"]))).not.toHaveProperty("row_number");
  expect(JSON.parse(String(rows[1]!["data"]))).not.toHaveProperty("file_type");
  expect(JSON.parse(String(rows[0]!["data"]))).not.toHaveProperty("text_type");
  expect(
    db.prepare("SELECT file_type FROM assets WHERE path = ?").get("old.md")?.["file_type"],
  ).toBe("MD");
  expect(rows[2]!["data"]).toBe("broken-json");
  expect(
    db.prepare("SELECT file_type FROM assets WHERE path = 'script.rpy'").get()?.["file_type"],
  ).toBe("RENPY_RPY");
  expect(JSON.parse(String(rows[3]!["data"]))).toMatchObject({
    dst: "译文",
    extra_field: { renpy_rpy: { v: 1 } },
  });
  expect(read_meta(db, PROJECT_DATABASE_APPLIED_WRITEBACK_MIGRATIONS_META_KEY)).toEqual([
    ...early_ids,
    "project-item-public-contract",
    "asset-file-type",
    "renpy-rpy-file-type",
    "item-name-text",
  ]);
  expect(db.prepare("SELECT sort_order FROM assets").get()?.["sort_order"]).toBe(0);
  expect(
    db
      .prepare("SELECT data FROM assets ORDER BY id")
      .all()
      .every((row) => Buffer.from(row["data"] as Uint8Array).equals(compressed)),
  ).toBe(true);
  const meta = db.prepare("SELECT * FROM meta ORDER BY key").all();
  run_project_database_migrations(db, "1.0.0");
  expect(db.prepare("SELECT data FROM items ORDER BY id").all()).toEqual(rows);
  expect(db.prepare("SELECT * FROM meta ORDER BY key").all()).toEqual(meta);
});

it("空库完成迁移后新增的原生 Ren’Py 资产在重新打开时保留身份", () => {
  using db = new DatabaseSync(":memory:");
  run_project_database_migrations(db, "1.0.0");
  db.exec(
    "INSERT INTO assets (path, file_type, data, original_size, compressed_size) VALUES ('game.renpy', 'RENPY', X'', 0, 0)",
  );
  const item = { file_path: "game.renpy", extra_field: { renpy: { key: "say:1" } } };
  db.prepare("INSERT INTO items(data) VALUES (?)").run(JSON.stringify(item));
  run_project_database_migrations(db, "1.0.0");
  expect(db.prepare("SELECT file_type FROM assets").get()?.["file_type"]).toBe("RENPY");
  expect(JSON.parse(String(db.prepare("SELECT data FROM items").get()?.["data"]))).toEqual(item);
});
