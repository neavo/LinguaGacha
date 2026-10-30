import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { run_item_name_text_migration } from "./item-name-text-migration";

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
