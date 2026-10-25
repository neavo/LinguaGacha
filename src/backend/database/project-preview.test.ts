import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { read_project_preview } from "./project-preview";

it("旧表摘要按 id 排序，只读取概览字段并解释历史完成状态", () => {
  using db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO meta VALUES ('created_at', '"2020-01-01"'), ('updated_at', '"2020-02-02"'), ('unrelated', 'invalid-json');
    CREATE TABLE assets (id INTEGER PRIMARY KEY, path TEXT);
    INSERT INTO assets VALUES (2, 'a.txt'), (1, 'z.txt');
    CREATE TABLE items (id INTEGER PRIMARY KEY, data TEXT);
    INSERT INTO items VALUES (1, '{"status":"PROCESSED_IN_PAST"}'), (2, '{"status":"PROCESSING"}'), (3, '{"status":"ERROR"}');
  `);
  expect(read_project_preview(db)).toMatchObject({
    file_paths: ["z.txt", "a.txt"],
    created_at: "2020-01-01",
    updated_at: "2020-02-02",
    translation_stats: {
      total_items: 3,
      completed_count: 1,
      failed_count: 1,
      pending_count: 1,
    },
  });
});
