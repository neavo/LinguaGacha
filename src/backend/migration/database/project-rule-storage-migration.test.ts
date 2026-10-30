import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { JsonTool } from "../../../shared/utils/json-tool";
import { run_project_rule_storage_migration } from "./project-rule-storage-migration";

describe("run_project_rule_storage_migration", () => {
  it("把旧规则槽位和 payload 写回当前单行形状", () => {
    using db = new DatabaseSync(":memory:");
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

    run_project_rule_storage_migration(db);

    expect(read_rule_rows(db)).toEqual([
      {
        type: "glossary",
        data: [{ src: "乙", dst: "B" }, { value: "散落值" }],
      },
      { type: "translation_prompt", data: { text: "旧提示词" } },
    ]);
  });

  it("停用的语言提示词槽位保留全部原始记录，不归一载荷或合并重复行", () => {
    using db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE rules (id INTEGER PRIMARY KEY, type TEXT NOT NULL, data TEXT NOT NULL)");
    const insert = db.prepare("INSERT INTO rules (type, data) VALUES (?, ?)");
    insert.run("CUSTOM_PROMPT_ZH", '"旧中文提示词"');
    insert.run("CUSTOM_PROMPT_ZH", '{ "text": "另一条旧中文提示词" }');
    insert.run("CUSTOM_PROMPT_EN", "broken-json");
    const original = db.prepare("SELECT * FROM rules ORDER BY id").all();

    run_project_rule_storage_migration(db);

    expect(db.prepare("SELECT * FROM rules ORDER BY id").all()).toEqual(original);
  });
});

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
