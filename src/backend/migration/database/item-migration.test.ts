import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { normalize_migration_file_type, write_item_migration } from "./item-migration";

it("已发布条目类型保持原值，MD 留给打开期重建", () => {
  const published_types = [
    "NONE",
    "MD",
    "MD_V2",
    "TXT",
    "SRT",
    "ASS",
    "VTT",
    "LRC",
    "EPUB",
    "XLSX",
    "WOLFXLSX",
    "RENPY",
    "TRANS",
    "KVJSON",
    "MESSAGEJSON",
  ];
  expect(published_types.map(normalize_migration_file_type)).toEqual(published_types);
});

it("未发布条目类型和非法值不进入历史迁移值域", () => {
  for (const value of [
    "RPGMAKER_MV_MZ",
    "RPGMAKER_RGSS",
    "PDF",
    "unknown",
    "txt",
    null,
    undefined,
    1,
  ]) {
    expect(normalize_migration_file_type(value)).toBe("NONE");
  }
});

it("逐行跳过损坏及非对象载荷，只写回发生变化的对象", () => {
  using db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, data TEXT NOT NULL)");
  const originals = ["broken-json", "[]", "null", '{"src":"keep"}', '{"src":"old","private":true}'];
  const insert = db.prepare("INSERT INTO items VALUES (?, ?)");
  originals.forEach((data, index) => insert.run(index + 1, data));
  const changes_before = db.prepare("SELECT total_changes() AS count").get()!["count"] as number;

  write_item_migration(db, (item) => ({
    data: { ...item, src: item["src"] === "old" ? "new" : item["src"] },
    changed: item["src"] === "old",
  }));

  expect(
    db
      .prepare("SELECT data FROM items ORDER BY id")
      .all()
      .map((row) => row["data"]),
  ).toEqual([...originals.slice(0, -1), '{"src":"new","private":true}']);
  // SQL 实际写入次数证明未变化行没有重写，独立于归一函数的 changed 返回值。
  expect(db.prepare("SELECT total_changes() AS count").get()!["count"]).toBe(changes_before + 1);
});
