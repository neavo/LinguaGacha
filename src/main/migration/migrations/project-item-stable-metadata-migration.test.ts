import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { JsonTool } from "../../../shared/utils/json-tool";
import { ProjectItemStableMetadataMigration } from "./project-item-stable-metadata-migration";

let temp_dir = "";
let databases: DatabaseSync[] = [];

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-item-migration-"));
  databases = [];
});

afterEach(() => {
  for (const db of databases) {
    db.close();
  }
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

describe("ProjectItemStableMetadataMigration", () => {
  it("把旧 item payload 写回当前稳定字段和值域并保留损坏 JSON", () => {
    const db = open_database("items.lg");
    db.exec(`
      CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL);
      INSERT INTO items (data) VALUES ('{"src":"@12 A","status":"PROCESSED_IN_PAST","file_type":"XLSX","row_number":"7"}');
      INSERT INTO items (data) VALUES ('{"src":"B","status":"PROCESSING"}');
      INSERT INTO items (data) VALUES ('not-json');
    `);

    ProjectItemStableMetadataMigration.run(db);

    expect(read_item_payloads(db)).toEqual([
      {
        src: "@12 A",
        status: "PROCESSED",
        file_type: "XLSX",
        row: 7,
        text_type: "WOLF",
        retry_count: 0,
      },
      { src: "B", status: "NONE", file_type: "NONE", text_type: "NONE", row: 0, retry_count: 0 },
      "not-json",
    ]);
  });
});

/**
 * item metadata 迁移测试用真实 items 表，确保损坏 JSON 行保留原样。
 */
function open_database(name: string): DatabaseSync {
  const db = new DatabaseSync(path.join(temp_dir, name));
  databases.push(db);
  return db;
}

/**
 * 可解析 item 按 JSON 断言，损坏 item 保留字符串以验证不丢数据。
 */
function read_item_payloads(db: DatabaseSync): unknown[] {
  return db
    .prepare("SELECT data FROM items ORDER BY id")
    .all()
    .map((row) => {
      const raw = String(row["data"]);
      try {
        return JsonTool.parseStrict(raw);
      } catch {
        return raw;
      }
    });
}
