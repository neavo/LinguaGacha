import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { run_renpy_rpy_file_type_migration } from "./renpy-rpy-file-type-migration";

it("只迁移旧 Ren’Py 资产及其对象元数据，保留译文、字符串和其他资产", () => {
  using db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE assets (path TEXT PRIMARY KEY, file_type TEXT);
    CREATE TABLE items (id INTEGER PRIMARY KEY, data TEXT);
    INSERT INTO assets VALUES ('script.rpy', 'RENPY'), ('empty.rpy', 'RENPY'), ('other.json', 'KVJSON');
  `);
  const rows = [
    {
      file_path: "script.rpy",
      dst: "译文",
      extra_field: { renpy: { v: 1, pair: { target_line: 3 } }, keep: true },
    },
    { file_path: "script.rpy", dst: "旧译文", extra_field: "translate chinese start:" },
    { file_path: "script.rpy", extra_field: null },
    { file_path: "other.json", extra_field: { renpy: { keep: true } } },
  ];
  const insert = db.prepare("INSERT INTO items(data) VALUES (?)");
  for (const row of rows) insert.run(JSON.stringify(row));
  run_renpy_rpy_file_type_migration(db);
  run_renpy_rpy_file_type_migration(db);
  expect(db.prepare("SELECT * FROM assets ORDER BY path").all()).toEqual([
    { path: "empty.rpy", file_type: "RENPY_RPY" },
    { path: "other.json", file_type: "KVJSON" },
    { path: "script.rpy", file_type: "RENPY_RPY" },
  ]);
  expect(
    db
      .prepare("SELECT data FROM items ORDER BY id")
      .all()
      .map((row) => JSON.parse(String(row["data"]))),
  ).toEqual([
    { ...rows[0], extra_field: { renpy_rpy: { v: 1, pair: { target_line: 3 } }, keep: true } },
    ...rows.slice(1),
  ]);
});
