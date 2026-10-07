import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { JsonTool } from "../../../shared/utils/json-tool";
import {
  normalize_item_public_contract_payload,
  run_project_item_public_contract_migration,
} from "./project-item-public-contract-migration";

describe("run_project_item_public_contract_migration", () => {
  it("补齐完整公开 DTO 依赖字段并保留格式私有字段", () => {
    using db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL);
      INSERT INTO items (data) VALUES ('{"src":"@12 A","name_src":["A",1],"row_number":"7","file_type":"XLSX","status":"BAD","retry_count":"2","skip_internal_filter":"yes","legacy_private":{"keep":true}}');
      INSERT INTO items (data) VALUES ('{"src":"legacy","file_type":"MD"}');
    `);

    run_project_item_public_contract_migration(db);

    expect(
      db
        .prepare("SELECT data FROM items ORDER BY id")
        .all()
        .map((row) => JsonTool.parseStrict(String(row["data"]))),
    ).toEqual([
      {
        src: "@12 A",
        name_src: ["A"],
        file_type: "XLSX",
        status: "NONE",
        retry_count: "2",
        skip_internal_filter: false,
        legacy_private: { keep: true },
        dst: "",
        name_dst: null,
        extra_field: "",
        tag: "",
        row: 7,
        file_path: "",
        text_type: "WOLF",
      },
      {
        src: "legacy",
        file_type: "MD",
        dst: "",
        name_src: null,
        name_dst: null,
        extra_field: "",
        tag: "",
        row: 0,
        file_path: "",
        text_type: "NONE",
        status: "NONE",
        skip_internal_filter: false,
      },
    ]);
  });

  it("已满足公开契约的 payload 不产生写回", () => {
    const item = {
      src: "原文",
      dst: "译文",
      name_src: null,
      name_dst: null,
      extra_field: { keep: true },
      tag: "",
      row: 1,
      file_type: "TXT",
      file_path: "a.txt",
      text_type: "NONE",
      status: "PROCESSED",
      skip_internal_filter: true,
    };

    expect(normalize_item_public_contract_payload(item)).toEqual({
      data: item,
      changed: false,
    });
  });
});
