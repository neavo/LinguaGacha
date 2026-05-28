import ExcelJS from "exceljs";
import type { Row } from "exceljs";

import type { ApiJsonValue } from "../api/api-types";
import { QualityRule } from "../../domain/quality";
import { NativeFs, default_native_fs, normalize_native_file_bytes } from "../../native/native-fs";
import { JsonTool } from "../../shared/utils/json-tool";
import { SpreadsheetTool } from "../../shared/utils/spreadsheet-tool";

export type QualityRuleFileEntry = Record<string, ApiJsonValue>;

/**
 * 从外部规则文件读取质量规则条目，供 GUI 导入和 CLI 单次任务资源复用同一解析口径。
 */
export async function load_quality_rule_entries_from_file(
  file_path: string,
  native_fs: NativeFs = default_native_fs,
): Promise<QualityRuleFileEntry[]> {
  if (file_path === "") {
    return [];
  }
  const lower_path = file_path.toLowerCase();
  if (lower_path.endsWith(".json")) {
    return load_quality_rule_entries_from_json(file_path, native_fs);
  }
  if (lower_path.endsWith(".xlsx")) {
    return load_quality_rule_entries_from_xlsx(file_path, native_fs);
  }
  return [];
}

/**
 * 同时导出 JSON 和 Excel 规则文件，保持 CLI 分析导出与 GUI 导出格式一致。
 */
export async function export_quality_rule_entries_to_files(
  base_path: string,
  entries: QualityRuleFileEntry[],
  native_fs: NativeFs = default_native_fs,
): Promise<void> {
  native_fs.write_file_sync(`${base_path}.json`, JsonTool.stringifyStrict(entries, { indent: 4 }));
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("rules");
  worksheet.columns = [{ width: 24 }, { width: 24 }, { width: 24 }, { width: 24 }, { width: 24 }];
  ["src", "dst", "info", "regex", "case_sensitive"].forEach((value, index) => {
    SpreadsheetTool.setCellValue(worksheet, 1, index + 1, value, 10);
  });
  entries.forEach((entry, index) => {
    const row = index + 2;
    SpreadsheetTool.setCellValue(worksheet, row, 1, entry["src"] ?? "", 10);
    SpreadsheetTool.setCellValue(worksheet, row, 2, entry["dst"] ?? "", 10);
    SpreadsheetTool.setCellValue(worksheet, row, 3, entry["info"] ?? "", 10);
    SpreadsheetTool.setCellValue(worksheet, row, 4, entry["regex"] ?? "", 10);
    SpreadsheetTool.setCellValue(worksheet, row, 5, entry["case_sensitive"] ?? "", 10);
  });
  native_fs.write_file_sync(
    `${base_path}.xlsx`,
    normalize_native_file_bytes(await workbook.xlsx.writeBuffer()),
  );
}

/**
 * JSON 导入兼容规则数组、键值对象和 RPG 角色 ID 名称表三种既有 GUI 格式。
 */
async function load_quality_rule_entries_from_json(
  file_path: string,
  native_fs: NativeFs,
): Promise<QualityRuleFileEntry[]> {
  const data = await JsonTool.repairParse(native_fs.read_file(file_path));
  const result: QualityRuleFileEntry[] = [];
  if (Array.isArray(data)) {
    for (const item of data) {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        continue;
      }
      const record = item as QualityRuleFileEntry;
      if ("src" in record) {
        push_normalized_rule(result, record);
      }
      push_rpg_actor_name_rules(result, record);
    }
  } else if (typeof data === "object" && data !== null) {
    for (const [src, dst] of Object.entries(data as Record<string, unknown>)) {
      push_normalized_rule(result, {
        src,
        dst: String(dst ?? ""),
        info: "",
        regex: false,
        case_sensitive: false,
      });
    }
  }
  return result.filter((item) => item["src"] !== "");
}

/**
 * Excel 导入读取前五列，列顺序与导出文件保持一致。
 */
async function load_quality_rule_entries_from_xlsx(
  file_path: string,
  native_fs: NativeFs,
): Promise<QualityRuleFileEntry[]> {
  const workbook = new ExcelJS.Workbook();
  await (workbook.xlsx.load as (data: unknown) => Promise<ExcelJS.Workbook>)(
    native_fs.read_file(file_path),
  );
  const worksheet = workbook.worksheets[0];
  if (worksheet === undefined) {
    return [];
  }
  const result: QualityRuleFileEntry[] = [];
  worksheet.eachRow((row) => {
    const src = read_excel_cell_text(row, 1);
    const dst = read_excel_cell_text(row, 2);
    if (src === "" || (src === "src" && dst === "dst")) {
      return;
    }
    push_normalized_rule(result, {
      src,
      dst,
      info: read_excel_cell_text(row, 3),
      regex: read_excel_cell_text(row, 4).toLowerCase() === "true",
      case_sensitive: read_excel_cell_text(row, 5).toLowerCase() === "true",
    });
  });
  return result;
}

/**
 * RPG 角色表导入会把名称和昵称转换为控制码映射，沿用 GUI 术语表导入语义。
 */
function push_rpg_actor_name_rules(
  result: QualityRuleFileEntry[],
  record: QualityRuleFileEntry,
): void {
  if (typeof record["id"] !== "number") {
    return;
  }
  const actor_id = Number(record["id"]);
  const name = String(record["name"] ?? "").trim();
  const nickname = String(record["nickname"] ?? "").trim();
  if (name !== "") {
    push_normalized_rule(result, {
      src: `\\n[${actor_id.toString()}]`,
      dst: name,
      info: "",
      regex: false,
      case_sensitive: false,
    });
    push_normalized_rule(result, {
      src: `\\N[${actor_id.toString()}]`,
      dst: name,
      info: "",
      regex: false,
      case_sensitive: false,
    });
  }
  if (nickname !== "") {
    push_normalized_rule(result, {
      src: `\\nn[${actor_id.toString()}]`,
      dst: nickname,
      info: "",
      regex: false,
      case_sensitive: false,
    });
    push_normalized_rule(result, {
      src: `\\NN[${actor_id.toString()}]`,
      dst: nickname,
      info: "",
      regex: false,
      case_sensitive: false,
    });
  }
}

/**
 * 规则条目写入前统一走 QualityRule 归一化，避免 GUI 和 CLI 出现字段差异。
 */
function push_normalized_rule(result: QualityRuleFileEntry[], entry: QualityRuleFileEntry): void {
  const normalized = QualityRule.normalize_entry(entry) as QualityRuleFileEntry;
  if (normalized["src"] !== "") {
    result.push(normalized);
  }
}

/**
 * Excel 单元格转文本只在文件 IO 边界处理，业务层不接触表格对象。
 */
function read_excel_cell_text(row: Row, column_number: number): string {
  return SpreadsheetTool.cellValueToText(row.getCell(column_number).value).trim();
}
