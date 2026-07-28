import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import ExcelJS from "exceljs";
import { afterEach, describe, expect, it } from "vitest";

import type { AppPathService } from "../app/app-path-service";
import {
  export_quality_rule_entries_to_files,
  load_quality_rule_entries_from_file,
  read_builtin_text_preserve_rule_sources,
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
  it("修复非标 JSON 并只读取外部可维护字段", async () => {
    const file_path = write_temp_file(
      "rules.json",
      '[{"entry_id":"rule-1","src":" Alice ","dst":" 爱丽丝 ","info":" 人名 ","regex":true},{"src":"",},]',
    );

    await expect(load_quality_rule_entries_from_file(file_path)).resolves.toEqual([
      {
        src: "Alice",
        dst: "爱丽丝",
        info: "人名",
        regex: true,
        case_sensitive: false,
      },
    ]);
  });

  it("兼容 RPG Maker Actors 与 KV 字典", async () => {
    const actors_path = write_temp_file(
      "actors.json",
      JSON.stringify([{ id: 7, name: "勇者", nickname: "小勇" }]),
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
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("rules");
    worksheet.addRow(["src", "dst", "info", "regex", "case_sensitive"]);
    worksheet.addRow(["HP", "生命值", "术语", "true", "TRUE"]);
    worksheet.addRow(["", "应跳过"]);
    worksheet.addRow(["MP", "魔力"]);
    fs.writeFileSync(file_path, Buffer.from(await workbook.xlsx.writeBuffer()));

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
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(`${base_path}.xlsx`);
    const cell = workbook.worksheets[0]?.getCell(2, 1);
    expect(cell?.value).toBe("'=SUM(A1:A2)");
  });

  it("读取指定文本类型的内置保护源文本", () => {
    const root = create_temp_root();
    fs.writeFileSync(
      path.join(root, "kag.json"),
      JSON.stringify([{ src: "<keep>" }, { src: " " }, null]),
      "utf-8",
    );
    const paths = {
      get_quality_rule_builtin_preset_dir: () => root,
    } as unknown as AppPathService;

    expect(read_builtin_text_preserve_rule_sources(paths, "KAG")).toEqual(["<keep>"]);
  });
});

function write_temp_file(file_name: string, content: string): string {
  const root = create_temp_root();
  const file_path = path.join(root, file_name);
  fs.writeFileSync(file_path, content, "utf-8");
  return file_path;
}

function create_temp_root(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-quality-rule-io-"));
  cleanup_roots.push(root);
  return root;
}
