import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { JsonTool } from "../../../shared/utils/json-tool";
import { run_quality_rule_entry_identity_migration } from "./quality-rule-entry-identity-migration";

const CURRENT_ENTRY_ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{5}$/u; // 迁移白名单是测试的独立格式依据。

describe("run_quality_rule_entry_identity_migration", () => {
  it("保留白名单内唯一身份并重建其余身份", () => {
    using temp_dir = fs.mkdtempDisposableSync(
      path.join(os.tmpdir(), "linguagacha-quality-rule-identity-migration-"),
    );
    using db = new DatabaseSync(path.join(temp_dir.path, "rules.lg"));
    create_schema(db);
    const current_quality_revision = 7; // 未变化 kind 持有迁移前的 aggregate 最大值。
    write_meta(db, "quality_rule_revision.glossary", 4);
    write_meta(db, "quality_rule_revision.text_preserve", current_quality_revision);
    write_meta(db, "quality_rule_revision.pre_replacement", 2);
    write_meta(db, "quality_rule_revision.post_replacement", 1);
    write_rules(db, "glossary", [
      { entry_id: "ABCDE", src: "保留", dst: "A" },
      { entry_id: "ABCDE", src: "重复", dst: "B" },
      { entry_id: "legacy", src: "旧格式", dst: "C" },
      { src: "缺失", dst: "D" },
    ]);
    write_rules(db, "text_preserve", [{ entry_id: "ABCDE", src: "跨 kind 保持" }]);
    write_rules(db, "pre_translation_replacement", [{ entry_id: " VWXYZ ", src: "前", dst: "后" }]);

    run_quality_rule_entry_identity_migration(db);

    const glossary = read_rules(db, "glossary");
    const glossary_ids = glossary.map((entry) => String(entry["entry_id"]));
    expect(glossary_ids[0]).toBe("ABCDE");
    expect(new Set(glossary_ids)).toHaveLength(glossary_ids.length);
    expect(glossary_ids).toEqual(
      glossary_ids.map(() => expect.stringMatching(CURRENT_ENTRY_ID_PATTERN)),
    );
    expect(glossary.map(({ entry_id: _entry_id, ...entry }) => entry)).toEqual([
      { src: "保留", dst: "A" },
      { src: "重复", dst: "B" },
      { src: "旧格式", dst: "C" },
      { src: "缺失", dst: "D" },
    ]);
    expect(read_rules(db, "text_preserve")).toEqual([{ entry_id: "ABCDE", src: "跨 kind 保持" }]);
    expect(read_rules(db, "pre_translation_replacement")[0]?.["entry_id"]).toMatch(
      CURRENT_ENTRY_ID_PATTERN,
    );
    expect(read_meta(db, "quality_rule_revision.glossary")).toBe(current_quality_revision + 1);
    expect(read_meta(db, "quality_rule_revision.pre_replacement")).toBe(
      current_quality_revision + 1,
    );
    expect(read_meta(db, "quality_rule_revision.text_preserve")).toBe(current_quality_revision);
    expect(read_meta(db, "quality_rule_revision.post_replacement")).toBe(1);

    const first_result = read_rule_rows(db);
    run_quality_rule_entry_identity_migration(db);

    expect(read_rule_rows(db)).toEqual(first_result);
    expect(read_meta(db, "quality_rule_revision.glossary")).toBe(current_quality_revision + 1);
    expect(read_meta(db, "quality_rule_revision.pre_replacement")).toBe(
      current_quality_revision + 1,
    );
  });
});

/** 建立迁移需要的最小真实 SQLite 结构。 */
function create_schema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      data TEXT NOT NULL
    );
  `);
}

/** 按项目 JSON 存储格式写入 meta。 */
function write_meta(db: DatabaseSync, key: string, value: unknown): void {
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(
    key,
    JsonTool.stringifyStrict(value),
  );
}

/** 按项目 JSON 存储格式读取 meta。 */
function read_meta(db: DatabaseSync, key: string): unknown {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
  return row === undefined ? null : JsonTool.parseStrict(String(row["value"]));
}

/** 为指定物理规则槽位写入测试条目。 */
function write_rules(db: DatabaseSync, type: string, entries: unknown[]): void {
  db.prepare("INSERT INTO rules (type, data) VALUES (?, ?)").run(
    type,
    JsonTool.stringifyStrict(entries),
  );
}

/** 读取迁移后的规则数组，形状违约时让测试直接失败。 */
function read_rules(db: DatabaseSync, type: string): Array<Record<string, unknown>> {
  const row = db.prepare("SELECT data FROM rules WHERE type = ?").get(type);
  const entries = row === undefined ? [] : JsonTool.parseStrict<unknown>(String(row["data"]));
  if (!Array.isArray(entries)) {
    throw new TypeError("Expected migrated rule entries to be an array.");
  }
  return entries as Array<Record<string, unknown>>;
}

/** 读取完整规则行，用于证明重复执行不会继续改写持久事实。 */
function read_rule_rows(db: DatabaseSync): Array<{ type: string; data: unknown }> {
  return db
    .prepare("SELECT type, data FROM rules ORDER BY id")
    .all()
    .map((row) => ({
      type: String(row["type"]),
      data: JsonTool.parseStrict(String(row["data"])),
    }));
}
