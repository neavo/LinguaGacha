import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { JsonTool } from "../../../shared/utils/json-tool";
import {
  PROJECT_DATABASE_SCHEMA_VERSION,
  ProjectSchemaMigration,
} from "./project-schema-migration";

let temp_dir = "";
let databases: DatabaseSync[] = [];

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-schema-migration-"));
  databases = [];
});

afterEach(() => {
  for (const db of databases) {
    try {
      db.close();
    } catch {}
  }
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

describe("ProjectSchemaMigration", () => {
  it("为空数据库补齐当前 schema、索引和 schema_version", () => {
    const db = open_database("schema.lg");

    ProjectSchemaMigration.run(db);

    expect(read_table_names(db)).toEqual([
      "analysis_candidate_aggregate",
      "analysis_item_checkpoint",
      "assets",
      "items",
      "meta",
      "rules",
      "sqlite_sequence",
    ]);
    expect(read_meta_number(db, "schema_version")).toBe(PROJECT_DATABASE_SCHEMA_VERSION);
  });

  it("旧 assets 缺少 sort_order 时按 id 顺序补齐稳定文件顺序", () => {
    const db = open_database("legacy-assets.lg");
    db.exec(`
      CREATE TABLE assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        data BLOB NOT NULL,
        original_size INTEGER NOT NULL,
        compressed_size INTEGER NOT NULL
      );
    `);
    db.prepare(
      "INSERT INTO assets (path, data, original_size, compressed_size) VALUES (?, ?, ?, ?)",
    ).run("b.txt", Buffer.from("b"), 1, 1);
    db.prepare(
      "INSERT INTO assets (path, data, original_size, compressed_size) VALUES (?, ?, ?, ?)",
    ).run("a.txt", Buffer.from("a"), 1, 1);

    ProjectSchemaMigration.run(db);

    expect(
      db
        .prepare("SELECT path, sort_order FROM assets ORDER BY id")
        .all()
        .map((row) => ({ path: String(row["path"]), sort_order: Number(row["sort_order"]) })),
    ).toEqual([
      { path: "b.txt", sort_order: 0 },
      { path: "a.txt", sort_order: 1 },
    ]);
  });
});

/**
 * schema 测试使用真实 SQLite 文件，覆盖 PRAGMA table_info 和 ALTER TABLE 行为。
 */
function open_database(name: string): DatabaseSync {
  const db = new DatabaseSync(path.join(temp_dir, name));
  databases.push(db);
  return db;
}

/**
 * 读取 sqlite_master 只用于断言 schema 迁移产生的公开表集合。
 */
function read_table_names(db: DatabaseSync): string[] {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => String(row["name"]));
}

/**
 * schema_version 按 JSON 数字存储，测试读取时保持同一序列化规则。
 */
function read_meta_number(db: DatabaseSync, key: string): number {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
  return row === undefined ? 0 : Number(JsonTool.parseStrict(String(row["value"])));
}
