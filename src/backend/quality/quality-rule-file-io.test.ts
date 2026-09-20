import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { spreadsheet_fixture, spreadsheet_values } from "../../test/spreadsheet-fixture";
import { afterEach, describe, expect, it } from "vitest";

import {
  export_quality_rule_entries_to_files,
  load_quality_rule_entries_from_file,
} from "./quality-rule-file-io";

const cleanup_roots: string[] = [];

afterEach(() => {
  while (cleanup_roots.length > 0) {
    const root = cleanup_roots.pop();
    if (root !== undefined) {
      fs.rmSync(root, { force: true, recursive: true });
    }
  }
});

describe("quality-rule-file-io", () => {
  it("修复非标 JSON 并保留外部字段给领域边界统一校验", async () => {
    const file_path = write_temp_file(
      "rules.json",
      '[{"entry_id":"rule-1","src":" Alice ","dst":" 爱丽丝 ","info":" 人名 ","regex":true},{"src":"",},]',
    );

    await expect(load_quality_rule_entries_from_file(file_path)).resolves.toEqual([
      {
        src: " Alice ",
        dst: " 爱丽丝 ",
        info: " 人名 ",
        regex: true,
      },
      { src: "" },
    ]);
  });

  it("兼容 RPG Maker Actors 与 KV 字典", async () => {
    const actors_path = write_temp_file(
      "actors.json",
      JSON.stringify([
        null,
        { id: 1, name: "", nickname: "" },
        { id: 7, name: "勇者", nickname: "小勇" },
      ]),
    );
    const kv_path = write_temp_file("kv.json", JSON.stringify({ A: "甲", B: null }));

    await expect(load_quality_rule_entries_from_file(actors_path)).resolves.toEqual([
      { src: "\\n[7]", dst: "勇者", info: "", regex: false, case_sensitive: false },
      { src: "\\N[7]", dst: "勇者", info: "", regex: false, case_sensitive: false },
      { src: "\\nn[7]", dst: "小勇", info: "", regex: false, case_sensitive: false },
      { src: "\\NN[7]", dst: "小勇", info: "", regex: false, case_sensitive: false },
    ]);
    await expect(load_quality_rule_entries_from_file(kv_path)).resolves.toEqual([
      { src: "A", dst: "甲", info: "", regex: false, case_sensitive: false },
      { src: "B", dst: "", info: "", regex: false, case_sensitive: false },
    ]);
  });

  it("从 Excel 规则文件读取前五列并跳过表头", async () => {
    const root = create_temp_root();
    const file_path = path.join(root, "rules.xlsx");
    fs.writeFileSync(
      file_path,
      await spreadsheet_fixture({
        A1: "src",
        B1: "dst",
        C1: "info",
        D1: "regex",
        E1: "case_sensitive",
        A2: "HP",
        B2: "生命值",
        C2: "术语",
        D2: true,
        E2: "TRUE",
        A3: "",
        B3: "应跳过",
        A4: "MP",
        B4: "魔力",
      }),
    );

    await expect(load_quality_rule_entries_from_file(file_path)).resolves.toEqual([
      {
        src: "HP",
        dst: "生命值",
        info: "术语",
        regex: true,
        case_sensitive: true,
      },
      { src: "MP", dst: "魔力", info: "", regex: false, case_sensitive: false },
    ]);
  });

  it("导出时只写外部字段并把公式样文本保存为普通单元格", async () => {
    const root = create_temp_root();
    const base_path = path.join(root, "glossary");

    await export_quality_rule_entries_to_files(base_path, [
      {
        entry_id: "rule-1",
        src: "=SUM(A1:A2)",
        dst: "爱丽丝",
        info: "人名",
        regex: false,
        case_sensitive: false,
      },
    ]);

    expect(JSON.parse(fs.readFileSync(`${base_path}.json`, "utf-8"))).toEqual([
      {
        src: "=SUM(A1:A2)",
        dst: "爱丽丝",
        info: "人名",
        regex: false,
        case_sensitive: false,
      },
    ]);
    const cells = await spreadsheet_values(fs.readFileSync(`${base_path}.xlsx`));
    expect(cells.A2).toBe("'=SUM(A1:A2)");
  });
});

/** 写入隔离的外部规则文件，供真实 IO 入口读取。 */
function write_temp_file(file_name: string, content: string): string {
  const root = create_temp_root();
  const file_path = path.join(root, file_name);
  fs.writeFileSync(file_path, content, "utf-8");
  return file_path;
}

/** 登记临时目录，由测试清理统一回收。 */
function create_temp_root(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-quality-rule-io-"));
  cleanup_roots.push(root);
  return root;
}
