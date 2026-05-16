import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { JsonTool } from "../../shared/utils/json-tool";
import { ZstdTool } from "../../shared/utils/zstd-tool";
import {
  PROJECT_DATABASE_SCHEMA_VERSION,
  PROJECT_DATABASE_WRITEBACK_MIGRATION_VERSION,
  ProjectDatabaseMigrationService,
} from "./project-database-migration-service";

let temp_dir = "";
let migration_test_databases: DatabaseSync[] = [];

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-db-migration-"));
  migration_test_databases = [];
});

afterEach(() => {
  for (const db of migration_test_databases) {
    try {
      db.close();
    } catch {
      // 单个测试可能已经关闭句柄；收尾阶段只保证临时目录可清理
    }
  }
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

describe("ProjectDatabaseMigrationService", () => {
  it("为空数据库补齐当前 schema 和索引", () => {
    const db = open_database("schema.lg");

    ProjectDatabaseMigrationService.migrate(db);

    expect(read_table_names(db)).toEqual([
      "analysis_candidate_aggregate",
      "analysis_item_checkpoint",
      "assets",
      "items",
      "meta",
      "rules",
      "sqlite_sequence",
    ]);
    expect(read_index_names(db)).toEqual([
      "idx_analysis_item_checkpoint_status",
      "idx_assets_path",
      "idx_rules_type",
      "sqlite_autoindex_analysis_candidate_aggregate_1",
      "sqlite_autoindex_assets_1",
      "sqlite_autoindex_meta_1",
    ]);
    expect(read_meta_number(db, "schema_version")).toBe(PROJECT_DATABASE_SCHEMA_VERSION);
    expect(read_meta_number(db, "writeback_migration_version")).toBe(
      PROJECT_DATABASE_WRITEBACK_MIGRATION_VERSION,
    );
  });

  it("既有 schema_version 不会跳过未标记的写回迁移", () => {
    const db = open_database("schema-version-with-legacy-data.lg");
    db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        data TEXT NOT NULL
      );
    `);
    db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(
      "schema_version",
      JsonTool.stringifyStrict(PROJECT_DATABASE_SCHEMA_VERSION),
    );
    db.prepare("INSERT INTO rules (type, data) VALUES (?, ?)").run(
      "GLOSSARY",
      JsonTool.stringifyStrict([{ src: "旧术语", dst: "Legacy" }]),
    );

    ProjectDatabaseMigrationService.migrate(db);

    expect(read_rule_rows(db)).toEqual([
      { type: "glossary", data: [{ src: "旧术语", dst: "Legacy" }] },
    ]);
    expect(read_meta_number(db, "writeback_migration_version")).toBe(
      PROJECT_DATABASE_WRITEBACK_MIGRATION_VERSION,
    );
  });

  it("损坏的写回迁移版本会按未执行处理并修复旧规则类型", () => {
    const db = open_database("corrupted-writeback-version.lg");
    db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        data TEXT NOT NULL
      );
    `);
    db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(
      "writeback_migration_version",
      "not-json",
    );
    db.prepare("INSERT INTO rules (type, data) VALUES (?, ?)").run(
      "TEXT_PRESERVE",
      JsonTool.stringifyStrict([{ src: "保留原文", dst: "" }]),
    );

    ProjectDatabaseMigrationService.migrate(db);

    expect(read_rule_rows(db)).toEqual([
      { type: "text_preserve", data: [{ src: "保留原文", dst: "" }] },
    ]);
    expect(read_meta_number(db, "writeback_migration_version")).toBe(
      PROJECT_DATABASE_WRITEBACK_MIGRATION_VERSION,
    );
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

    ProjectDatabaseMigrationService.migrate(db);

    expect(read_asset_order(db)).toEqual([
      { path: "b.txt", sort_order: 0 },
      { path: "a.txt", sort_order: 1 },
    ]);
  });

  it("旧大写规则槽位迁到当前物理类型且冲突时保留当前事实", () => {
    const db = open_database("legacy-rules.lg");
    db.exec(`
      CREATE TABLE rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        data TEXT NOT NULL
      );
    `);
    db.prepare("INSERT INTO rules (type, data) VALUES (?, ?)").run(
      "GLOSSARY",
      JsonTool.stringifyStrict([{ src: "旧术语", dst: "Legacy" }]),
    );
    db.prepare("INSERT INTO rules (type, data) VALUES (?, ?)").run(
      "TEXT_PRESERVE",
      JsonTool.stringifyStrict([{ text: "保护" }]),
    );
    db.prepare("INSERT INTO rules (type, data) VALUES (?, ?)").run(
      "glossary",
      JsonTool.stringifyStrict([{ src: "当前术语", dst: "Current" }]),
    );

    ProjectDatabaseMigrationService.migrate(db);

    expect(read_rule_rows(db)).toEqual([
      { type: "text_preserve", data: [{ text: "保护" }] },
      { type: "glossary", data: [{ src: "当前术语", dst: "Current" }] },
    ]);
  });

  it("旧规则 payload 写回当前单行数组和文本对象形状", () => {
    const db = open_database("legacy-rule-payload.lg");
    db.exec(`
      CREATE TABLE rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        data TEXT NOT NULL
      );
    `);
    db.prepare("INSERT INTO rules (type, data) VALUES (?, ?)").run(
      "glossary",
      JsonTool.stringifyStrict({ src: "甲", dst: "A" }),
    );
    db.prepare("INSERT INTO rules (type, data) VALUES (?, ?)").run(
      "glossary",
      JsonTool.stringifyStrict([{ src: "乙", dst: "B" }, "散落值"]),
    );
    db.prepare("INSERT INTO rules (type, data) VALUES (?, ?)").run(
      "translation_prompt",
      JsonTool.stringifyStrict("旧提示词"),
    );

    ProjectDatabaseMigrationService.migrate(db);

    expect(read_rule_rows(db)).toEqual([
      {
        type: "glossary",
        data: [{ src: "甲", dst: "A" }, { src: "乙", dst: "B" }, { value: "散落值" }],
      },
      { type: "translation_prompt", data: { text: "旧提示词" } },
    ]);
  });

  it("旧 item payload 写回当前字段和值域并保留损坏 JSON 原文", () => {
    const db = open_database("legacy-items.lg");
    db.exec(`
      CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL);
      INSERT INTO items (data) VALUES ('{"src":"@12 A","status":"PROCESSED_IN_PAST","file_type":"XLSX","row_number":"7"}');
      INSERT INTO items (data) VALUES ('{"src":"B","status":"PROCESSING"}');
      INSERT INTO items (data) VALUES ('{"src":"C","status":"UNKNOWN"}');
      INSERT INTO items (data) VALUES ('not-json');
    `);

    ProjectDatabaseMigrationService.migrate(db);

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
      { src: "C", status: "NONE", file_type: "NONE", text_type: "NONE", row: 0, retry_count: 0 },
      "not-json",
    ]);
  });

  it("旧 TRANS item metadata 按原始 asset 行确定性补齐", () => {
    const db = open_database("legacy-trans-items.lg");
    db.exec(`
      CREATE TABLE assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        data BLOB NOT NULL,
        original_size INTEGER NOT NULL,
        compressed_size INTEGER NOT NULL
      );
      CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL);
    `);
    insert_asset(
      db,
      "demo.trans",
      {
        project: {
          gameEngine: "",
          files: {
            "script-a.json": {
              data: [["强制翻译行", ""]],
            },
            "script-b.json": {
              data: [["普通行", ""]],
            },
          },
        },
      },
      0,
    );
    db.prepare("INSERT INTO items (data) VALUES (?)").run(
      JsonTool.stringifyStrict({
        src: "强制翻译行",
        file_type: "TRANS",
        file_path: "demo.trans",
        tag: "script-a.json",
        row: 0,
        extra_field: { tag: ["aqua"] },
      }),
    );
    db.prepare("INSERT INTO items (data) VALUES (?)").run(
      JsonTool.stringifyStrict({
        src: "普通行",
        file_type: "TRANS",
        file_path: "demo.trans",
        tag: "script-b.json",
        row: 1,
        extra_field: { tag: [] },
        skip_internal_filter: "bad",
      }),
    );

    ProjectDatabaseMigrationService.migrate(db);

    expect(read_item_payloads(db)).toEqual([
      {
        src: "强制翻译行",
        file_type: "TRANS",
        file_path: "demo.trans",
        tag: "script-a.json",
        row: 0,
        extra_field: {
          tag: ["aqua"],
          trans_ref: { file_key: "script-a.json", row_index: 0 },
        },
        status: "NONE",
        skip_internal_filter: true,
        text_type: "NONE",
        retry_count: 0,
      },
      {
        src: "普通行",
        file_type: "TRANS",
        file_path: "demo.trans",
        tag: "script-b.json",
        row: 1,
        extra_field: {
          tag: [],
          trans_ref: { file_key: "script-b.json", row_index: 0 },
        },
        status: "NONE",
        text_type: "NONE",
        retry_count: 0,
      },
    ]);
  });

  it("旧分析 checkpoint 状态写回任务进度三态", () => {
    const db = open_database("legacy-checkpoints.lg");
    db.exec(`
      CREATE TABLE analysis_item_checkpoint (
        item_id INTEGER PRIMARY KEY,
        status TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        error_count INTEGER NOT NULL
      );
      INSERT INTO analysis_item_checkpoint (item_id, status, updated_at, error_count)
      VALUES (1, 'PROCESSED_IN_PAST', '2026-01-01', 0);
      INSERT INTO analysis_item_checkpoint (item_id, status, updated_at, error_count)
      VALUES (2, 'PROCESSING', '2026-01-01', 0);
      INSERT INTO analysis_item_checkpoint (item_id, status, updated_at, error_count)
      VALUES (3, 'BROKEN', '2026-01-01', 0);
    `);

    ProjectDatabaseMigrationService.migrate(db);

    expect(read_checkpoint_statuses(db)).toEqual([
      { item_id: 1, status: "PROCESSED" },
      { item_id: 2, status: "NONE" },
      { item_id: 3, status: "NONE" },
    ]);
  });
});

function open_database(name: string): DatabaseSync {
  const db = new DatabaseSync(path.join(temp_dir, name));
  migration_test_databases.push(db);
  return db;
}

function read_table_names(db: DatabaseSync): string[] {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => String(row["name"]));
}

function read_index_names(db: DatabaseSync): string[] {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name")
    .all()
    .map((row) => String(row["name"]));
}

function read_meta_number(db: DatabaseSync, key: string): number {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
  if (row === undefined) {
    return 0;
  }
  return Number(JsonTool.parseStrict(String(row["value"])));
}

function read_asset_order(db: DatabaseSync): Array<{ path: string; sort_order: number }> {
  return db
    .prepare("SELECT path, sort_order FROM assets ORDER BY id")
    .all()
    .map((row) => ({
      path: String(row["path"]),
      sort_order: Number(row["sort_order"]),
    }));
}

function read_rule_rows(db: DatabaseSync): Array<{ type: string; data: unknown }> {
  return db
    .prepare("SELECT type, data FROM rules ORDER BY id")
    .all()
    .map((row) => ({
      type: String(row["type"]),
      data: JsonTool.parseStrict(String(row["data"])),
    }));
}

function insert_asset(
  db: DatabaseSync,
  asset_path: string,
  payload: unknown,
  sort_order: number,
): void {
  const raw = Buffer.from(JsonTool.stringifyStrict(payload), "utf-8");
  const compressed = ZstdTool.compress(raw);
  db.prepare(
    `INSERT INTO assets (path, sort_order, data, original_size, compressed_size)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(asset_path, sort_order, compressed, raw.byteLength, compressed.byteLength);
}

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

function read_checkpoint_statuses(db: DatabaseSync): Array<{ item_id: number; status: string }> {
  return db
    .prepare("SELECT item_id, status FROM analysis_item_checkpoint ORDER BY item_id")
    .all()
    .map((row) => ({
      item_id: Number(row["item_id"]),
      status: String(row["status"]),
    }));
}
