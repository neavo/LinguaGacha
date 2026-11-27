import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import {
  export_quality_rule_entries_to_files,
  load_quality_rule_entries_from_file,
} from "./quality-rule-file-io";

describe("quality-rule-file-io", () => {
  it("修复非标 JSON 并保留外部字段给领域边界统一校验", async () => {
    using root = create_temp_root();
    const file_path = path.join(root.path, "rules.json");
    fs.writeFileSync(
      file_path,
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
    using root = create_temp_root();
    const actors_path = path.join(root.path, "actors.json");
    const kv_path = path.join(root.path, "kv.json");
    fs.writeFileSync(
      actors_path,
      JSON.stringify([
        null,
        { id: 1, name: "", nickname: "" },
        { id: 7, name: "勇者", nickname: "小勇" },
      ]),
    );
    fs.writeFileSync(kv_path, JSON.stringify({ A: "甲", B: null }));

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

  it("从 Excel 导入显示文字和公式缓存，跳过表头和空原文", async () => {
    using root = create_temp_root();
    const file_path = path.join(root.path, "rules.xlsx");
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("rules").addRows([
      ["src", "dst", "info", "regex", "case_sensitive"],
      [
        { richText: [{ text: "H" }, { text: "P" }] },
        { text: "生命值", hyperlink: "https://example.com" },
        { formula: "1+1", result: 2 },
        true,
        "TRUE",
      ],
      ["", "应跳过"],
      ["MP", "魔力"],
    ]);
    await workbook.xlsx.writeFile(file_path);

    await expect(load_quality_rule_entries_from_file(file_path)).resolves.toEqual([
      {
        src: "HP",
        dst: "生命值",
        info: "2",
        regex: true,
        case_sensitive: true,
      },
      { src: "MP", dst: "魔力", info: "", regex: false, case_sensitive: false },
    ]);
  });

  it("导出时只写外部字段并把公式样文本保存为普通单元格", async () => {
    using root = create_temp_root();
    const base_path = path.join(root.path, "glossary");

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
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(`${base_path}.xlsx`);
    expect(workbook.worksheets[0]!.getCell("A2").value).toBe("'=SUM(A1:A2)");
  });
});

/** 为规则文件提供用例结束时自动清理的独立目录。 */
function create_temp_root(): ReturnType<typeof fs.mkdtempDisposableSync> {
  return fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-quality-rule-io-"));
}
