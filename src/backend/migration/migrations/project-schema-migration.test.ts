import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { JsonTool } from "../../../shared/utils/json-tool";
import {
  PROJECT_DATABASE_SCHEMA_VERSION,
  run_project_schema_migration,
} from "./project-schema-migration";

describe("run_project_schema_migration", () => {
  it("新建工程按文件与原页唯一保存页面，并记录 schema 版本", () => {
    using temp_dir = fs.mkdtempDisposableSync(
      path.join(os.tmpdir(), "linguagacha-schema-migration-"),
    );
    using db = new DatabaseSync(path.join(temp_dir.path, "schema.lg"));

    run_project_schema_migration(db);

    const insert = db.prepare("INSERT INTO pdf_pages(file_path, page, data) VALUES (?, ?, ?)");
    insert.run("a.pdf", 1, "{}");
    insert.run("b.pdf", 1, "{}");
    expect(() => insert.run("a.pdf", 1, "{}")).toThrow("UNIQUE constraint failed");
    expect(read_meta_number(db, "schema_version")).toBe(PROJECT_DATABASE_SCHEMA_VERSION);
  });

  it("旧 assets 缺少 sort_order 时按 id 顺序补齐稳定文件顺序", () => {
    using temp_dir = fs.mkdtempDisposableSync(
      path.join(os.tmpdir(), "linguagacha-schema-migration-"),
    );
    using db = new DatabaseSync(path.join(temp_dir.path, "legacy-assets.lg"));
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

    run_project_schema_migration(db);

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
 * schema_version 按 JSON 数字存储，测试读取时保持同一序列化规则。
 */
function read_meta_number(db: DatabaseSync, key: string): number {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
  return row === undefined ? 0 : Number(JsonTool.parseStrict(String(row["value"])));
}
