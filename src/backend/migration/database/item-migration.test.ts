import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { write_item_migration } from "./item-migration";

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
