import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import ExcelJS from "exceljs";
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
  it("从 JSON 规则数组读取外部可维护字段", async () => {
    const file_path = write_temp_file(
      "rules.json",
      JSON.stringify([
        { entry_id: "rule-1", src: " Alice ", dst: " 爱丽丝 ", info: " 人名 ", regex: true },
        { src: "", dst: "空项" },
      ]),
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

  it("从 Excel 规则文件读取前五列并跳过表头", async () => {
    const root = create_temp_root();
    const file_path = path.join(root, "rules.xlsx");
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("rules");
    worksheet.addRow(["src", "dst", "info", "regex", "case_sensitive"]);
    worksheet.addRow(["HP", "生命值", "术语", "false", "true"]);
    fs.writeFileSync(file_path, Buffer.from(await workbook.xlsx.writeBuffer()));

    await expect(load_quality_rule_entries_from_file(file_path)).resolves.toEqual([
      {
        src: "HP",
        dst: "生命值",
        info: "术语",
        regex: false,
        case_sensitive: true,
      },
    ]);
  });

  it("导出规则时只写外部可维护字段", async () => {
    const root = create_temp_root();
    const base_path = path.join(root, "glossary");

    await export_quality_rule_entries_to_files(base_path, [
      {
        entry_id: "rule-1",
        src: "Alice",
        dst: "爱丽丝",
        info: "人名",
        regex: false,
        case_sensitive: false,
      },
    ]);

    expect(JSON.parse(fs.readFileSync(`${base_path}.json`, "utf-8"))).toEqual([
      { src: "Alice", dst: "爱丽丝", info: "人名", regex: false, case_sensitive: false },
    ]);
    expect(fs.existsSync(`${base_path}.xlsx`)).toBe(true);
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
