import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { JsonTool } from "../../../shared/utils/json-tool";
import { run_project_item_stable_metadata_migration } from "./project-item-stable-metadata-migration";

describe("run_project_item_stable_metadata_migration", () => {
  it("把旧 item payload 写回当前稳定字段和值域并保留损坏 JSON", () => {
    using temp_dir = fs.mkdtempDisposableSync(
      path.join(os.tmpdir(), "linguagacha-item-migration-"),
    );
    using db = new DatabaseSync(path.join(temp_dir.path, "items.lg"));
    db.exec(`
      CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL);
      INSERT INTO items (data) VALUES ('{"src":"@12 A","status":"PROCESSED_IN_PAST","file_type":"XLSX","row_number":"7"}');
      INSERT INTO items (data) VALUES ('{"src":"B","status":"PROCESSING"}');
      INSERT INTO items (data) VALUES ('{"src":"legacy","status":"NONE","file_type":"MD"}');
      INSERT INTO items (data) VALUES ('not-json');
    `);

    run_project_item_stable_metadata_migration(db);

    expect(read_item_payloads(db)).toEqual([
      {
        src: "@12 A",
        status: "PROCESSED",
        file_type: "XLSX",
        row: 7,
        text_type: "WOLF",
        retry_count: 0,
      },
      {
        src: "B",
        status: "NONE",
        file_type: "NONE",
        text_type: "NONE",
        row: 0,
        retry_count: 0,
      },
      {
        src: "legacy",
        status: "NONE",
        file_type: "MD",
        text_type: "NONE",
        row: 0,
        retry_count: 0,
      },
      "not-json",
    ]);
  });
});

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
