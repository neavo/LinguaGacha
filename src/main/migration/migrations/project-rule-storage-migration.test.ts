import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { JsonTool } from "../../../shared/utils/json-tool";
import { ProjectRuleStorageMigration } from "./project-rule-storage-migration";

let temp_dir = "";
let databases: DatabaseSync[] = [];

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-rule-migration-"));
  databases = [];
});

afterEach(() => {
  for (const db of databases) {
    db.close();
  }
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

describe("ProjectRuleStorageMigration", () => {
  it("把旧规则槽位和 payload 写回当前单行形状", () => {
    const db = open_database("rules.lg");
    db.exec(`
      CREATE TABLE rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        data TEXT NOT NULL
      );
    `);
    db.prepare("INSERT INTO rules (type, data) VALUES (?, ?)").run(
      "GLOSSARY",
      JsonTool.stringifyStrict({ src: "甲", dst: "A" }),
    );
    db.prepare("INSERT INTO rules (type, data) VALUES (?, ?)").run(
      "glossary",
      JsonTool.stringifyStrict([{ src: "乙", dst: "B" }, "散落值"]),
    );
    db.prepare("INSERT INTO rules (type, data) VALUES (?, ?)").run(
      "TRANSLATION_PROMPT",
      JsonTool.stringifyStrict("旧提示词"),
    );

    ProjectRuleStorageMigration.run(db);

    expect(read_rule_rows(db)).toEqual([
      {
        type: "glossary",
        data: [{ src: "乙", dst: "B" }, { value: "散落值" }],
      },
      { type: "translation_prompt", data: { text: "旧提示词" } },
    ]);
  });
});

/**
 * 规则存储迁移测试用真实 rules 表，覆盖类型名和 payload 合并的 SQL 写回。
 */
function open_database(name: string): DatabaseSync {
  const db = new DatabaseSync(path.join(temp_dir, name));
  databases.push(db);
  return db;
}

/**
 * 规则 payload 按当前 JSON 形状反序列化后断言，避免测试绑定原始字符串顺序。
 */
function read_rule_rows(db: DatabaseSync): Array<{ type: string; data: unknown }> {
  return db
    .prepare("SELECT type, data FROM rules ORDER BY id")
    .all()
    .map((row) => ({
      type: String(row["type"]),
      data: JsonTool.parseStrict(String(row["data"])),
    }));
}
