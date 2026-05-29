import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { JsonTool } from "../../../shared/utils/json-tool";
import { ProjectItemPublicContractMigration } from "./project-item-public-contract-migration";

let temp_dir = "";
let databases: DatabaseSync[] = [];

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-item-contract-migration-"));
  databases = [];
});

afterEach(() => {
  for (const db of databases) {
    db.close();
  }
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

describe("ProjectItemPublicContractMigration", () => {
  it("补齐完整公开 DTO 依赖字段并保留格式私有字段", () => {
    const db = open_database("items.lg");
    db.exec(`
      CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL);
      INSERT INTO items (data) VALUES ('{"src":"@12 A","name_src":["A",1],"row_number":"7","file_type":"XLSX","status":"BAD","retry_count":"2","skip_internal_filter":"yes","legacy_private":{"keep":true}}');
      INSERT INTO items (data) VALUES ('not-json');
    `);

    ProjectItemPublicContractMigration.run(db);

    expect(read_item_payloads(db)).toEqual([
      {
        src: "@12 A",
        name_src: ["A"],
        file_type: "XLSX",
        status: "NONE",
        retry_count: 2,
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
      "not-json",
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
      retry_count: 0,
      skip_internal_filter: true,
    };

    expect(ProjectItemPublicContractMigration.normalize_item_payload(item)).toEqual({
      data: item,
      changed: false,
    });
  });
});

/**
 * item 公开契约迁移测试用真实 items 表，确保损坏 JSON 行保留原样。
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
