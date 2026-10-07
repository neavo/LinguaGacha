import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { JsonTool } from "../../../shared/utils/json-tool";
import { run_project_item_stable_metadata_migration } from "./project-item-stable-metadata-migration";

describe("run_project_item_stable_metadata_migration", () => {
  it("把旧 item payload 写回当前稳定字段和值域", () => {
    using db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL);
      INSERT INTO items (data) VALUES ('{"src":"@12 A","status":"PROCESSED_IN_PAST","file_type":"XLSX","row_number":"7"}');
      INSERT INTO items (data) VALUES ('{"src":"B","status":"PROCESSING","retry_count":"legacy"}');
      INSERT INTO items (data) VALUES ('{"src":"legacy","status":"NONE","file_type":"MD"}');
    `);

    run_project_item_stable_metadata_migration(db);

    expect(
      db
        .prepare("SELECT data FROM items ORDER BY id")
        .all()
        .map((row) => JsonTool.parseStrict(String(row["data"]))),
    ).toEqual([
      {
        src: "@12 A",
        status: "PROCESSED",
        file_type: "XLSX",
        row: 7,
        text_type: "WOLF",
      },
      {
        src: "B",
        status: "NONE",
        file_type: "NONE",
        text_type: "NONE",
        row: 0,
        retry_count: "legacy",
      },
      {
        src: "legacy",
        status: "NONE",
        file_type: "MD",
        text_type: "NONE",
        row: 0,
      },
    ]);
  });
});
