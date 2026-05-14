import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { JsonTool } from "../../shared/utils/json-tool";
import { ProjectDatabaseMigrationService } from "./project-database-migration-service";

let temp_dir = "";
let open_databases: DatabaseSync[] = [];

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-db-migration-"));
  open_databases = [];
});

afterEach(() => {
  for (const db of open_databases) {
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
  open_databases.push(db);
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
