import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { run_item_name_text_migration } from "./item-name-text-migration";
import {
  run_project_database_migrations,
  PROJECT_DATABASE_APPLIED_WRITEBACK_MIGRATIONS_META_KEY,
} from "../database-migrations";

it("只收敛历史姓名数组，保留空字符串、条目身份、未知字段和损坏 JSON", () => {
  using db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, data TEXT NOT NULL)");
  const originals = [
    { name_src: [123, "Alice", "tail"], name_dst: ["艾丽丝", "备注"] },
    { name_src: [], name_dst: [false, {}] },
    { name_src: "", name_dst: null },
    { name_src: ["", "Alice"], name_dst: "" },
    { name_src: "Alice", name_dst: "艾丽丝" },
  ].map((names, index) => ({
    ...names,
    row: index + 7,
    src: "原文",
    dst: "译文",
    status: "PROCESSED",
    extra_field: { private: [1, true] },
    unknown: "保留",
    file_path: "missing.txt",
  }));
  const insert = db.prepare("INSERT INTO items VALUES (?, ?)");
  originals.forEach((item, i) => insert.run(i + 10, JSON.stringify(item)));
  insert.run(99, "broken-json");
  insert.run(100, "null");
  run_item_name_text_migration(db);
  const rows = db.prepare("SELECT id, data FROM items ORDER BY id").all();
  const names = [
    { name_src: "Alice", name_dst: "艾丽丝" },
    { name_src: null, name_dst: null },
    { name_src: "", name_dst: null },
    { name_src: "", name_dst: "" },
    { name_src: "Alice", name_dst: "艾丽丝" },
  ];
  expect(
    rows.slice(0, 5).map((row) => ({ id: row.id, data: JSON.parse(String(row.data)) })),
  ).toEqual(originals.map((item, i) => ({ id: i + 10, data: { ...item, ...names[i] } })));
  expect(rows.slice(5)).toEqual([
    { id: 99, data: "broken-json" },
    { id: 100, data: "null" },
  ]);
});

it("旧迁移已完成时写入失败回滚姓名与标记，重试成功后重复打开跳过迁移", () => {
  using db = new DatabaseSync(":memory:");
  run_project_database_migrations(db, "1.0.0");
  const key = PROJECT_DATABASE_APPLIED_WRITEBACK_MIGRATIONS_META_KEY;
  const applied: string[] = JSON.parse(
    String(db.prepare("SELECT value FROM meta WHERE key = ?").get(key)!.value),
  );
  const previous = applied.filter((id) => id !== "item-name-text");
  db.prepare("UPDATE meta SET value = ? WHERE key = ?").run(JSON.stringify(previous), key);
  const insert = db.prepare("INSERT INTO items VALUES (?, ?)");
  for (const id of [1, 2])
    insert.run(
      id,
      JSON.stringify({
        name_src: ["Alice", "extra"],
        name_dst: ["译名"],
        row: id - 1,
        src: "正文",
        dst: "译文",
        status: "PROCESSED",
        unknown: { keep: true },
      }),
    );
  db.exec(
    "INSERT INTO assets (path, file_type, data, original_size, compressed_size) VALUES ('other.json', 'MESSAGEJSON', X'000102FF', 4, 4)",
  );
  const assets = db.prepare("SELECT * FROM assets").all();
  const original = db.prepare("SELECT * FROM items ORDER BY id").all();
  db.exec(
    "CREATE TRIGGER reject_name BEFORE UPDATE ON items WHEN OLD.id = 2 BEGIN SELECT RAISE(ABORT, 'name write failed'); END",
  );
  expect(() => run_project_database_migrations(db, "1.0.0")).toThrow("name write failed");
  expect(db.prepare("SELECT * FROM items ORDER BY id").all()).toEqual(original);
  expect(
    JSON.parse(String(db.prepare("SELECT value FROM meta WHERE key = ?").get(key)!.value)),
  ).toEqual(previous);
  expect(db.prepare("SELECT * FROM assets").all()).toEqual(assets);
  db.exec("DROP TRIGGER reject_name");
  run_project_database_migrations(db, "1.0.0");
  const migrated = db.prepare("SELECT * FROM items ORDER BY id").all();
  expect(migrated.map((row) => JSON.parse(String(row.data)))).toEqual(
    original.map((row) => ({
      ...JSON.parse(String(row.data)),
      name_src: "Alice",
      name_dst: "译名",
    })),
  );
  expect(
    JSON.parse(String(db.prepare("SELECT value FROM meta WHERE key = ?").get(key)!.value)),
  ).toEqual(applied);
  db.exec(
    "CREATE TRIGGER reject_repeat BEFORE UPDATE ON items BEGIN SELECT RAISE(ABORT, 'unexpected repeat'); END",
  );
  run_project_database_migrations(db, "1.0.0");
  expect(db.prepare("SELECT * FROM items ORDER BY id").all()).toEqual(migrated);
  expect(db.prepare("SELECT * FROM assets").all()).toEqual(assets);
});
