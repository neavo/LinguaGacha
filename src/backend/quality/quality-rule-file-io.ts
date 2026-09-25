import ExcelJS from "exceljs";
import { read_workbook, cell_text, write_cell } from "../file/spreadsheet";

import type { JsonRecord } from "../../domain/json";
import { NativeFs, default_native_fs, normalize_native_file_bytes } from "../../native/native-fs";
import { JsonTool } from "../../shared/utils/json-tool";

export type QualityRuleFileEntry = JsonRecord;

const RULE_COLUMNS = ["src", "dst", "info", "regex", "case_sensitive"] as const;
const RULE_COLUMN_WIDTH = 24;
const RULE_FONT_SIZE = 10;

/**
 * 从外部规则文件读取质量规则条目，供 GUI 导入和 CLI 单次任务资源复用同一解析口径。
 */
export async function load_quality_rule_entries_from_file(
  file_path: string,
  native_fs: NativeFs = default_native_fs,
): Promise<unknown[]> {
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
 * 同时导出 JSON 和 Excel 规则文件，保持质量规则外部文件格式一致。
 */
export async function export_quality_rule_entries_to_files(
  base_path: string,
  entries: QualityRuleFileEntry[],
  native_fs: NativeFs = default_native_fs,
): Promise<void> {
  const export_entries = entries.map((entry) => normalize_external_rule(entry));
  native_fs.write_file_sync(
    `${base_path}.json`,
    JsonTool.stringifyStrict(export_entries, { indent: 4 }),
  );
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("rules");
  sheet.columns = RULE_COLUMNS.map(() => ({ width: RULE_COLUMN_WIDTH }));
  RULE_COLUMNS.forEach((label, index) => write_cell(sheet, 1, index + 1, label, RULE_FONT_SIZE));
  export_entries.forEach((entry, index) =>
    RULE_COLUMNS.forEach((key, column) =>
      write_cell(sheet, index + 2, column + 1, entry[key] as string | boolean, RULE_FONT_SIZE),
    ),
  );
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
): Promise<unknown[]> {
  const data = await JsonTool.repairParse(native_fs.read_file(file_path));
  const result: unknown[] = [];
  if (Array.isArray(data)) {
    const has_rpg_actor_placeholder =
      data[0] === null &&
      data.slice(1).some((item) => {
        if (typeof item !== "object" || item === null || Array.isArray(item)) {
          return false;
        }
        const record = item as QualityRuleFileEntry;
        return typeof record["id"] === "number" && ("name" in record || "nickname" in record);
      });
    for (const [index, item] of data.entries()) {
      // RPG Maker 角色表固定用索引 0 的 null 占位；普通规则数组中的坏项仍交给领域边界拒绝。
      if (has_rpg_actor_placeholder && index === 0 && item === null) {
        continue;
      }
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        result.push(item);
        continue;
      }
      const record = item as QualityRuleFileEntry;
      let recognized = false;
      if ("src" in record) {
        result.push(project_external_rule_fields(record));
        recognized = true;
      }
      recognized = push_rpg_actor_name_rules(result, record) || recognized;
      if (!recognized) {
        result.push(project_external_rule_fields(record));
      }
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
  return result;
}

/**
 * Excel 导入读取前五列，列顺序与导出文件保持一致。
 */
async function load_quality_rule_entries_from_xlsx(
  file_path: string,
  native_fs: NativeFs,
): Promise<QualityRuleFileEntry[]> {
  const workbook = await read_workbook(native_fs.read_file(file_path));
  const sheet = workbook.worksheets[0];
  const result: QualityRuleFileEntry[] = [];
  sheet?.eachRow((row) => {
    const [src = "", dst = "", info = "", regex = "", case_sensitive = ""] = Array.from(
      { length: RULE_COLUMNS.length },
      (_, index) => cell_text(row.getCell(index + 1).value).trim(),
    );
    if (src === "" || (src === "src" && dst === "dst")) return;
    push_normalized_rule(result, {
      src,
      dst,
      info,
      regex: regex.toLowerCase() === "true",
      case_sensitive: case_sensitive.toLowerCase() === "true",
    });
  });
  return result;
}

/**
 * RPG 角色表导入会把名称和昵称转换为控制码映射，沿用 GUI 术语表导入语义。
 */
function push_rpg_actor_name_rules(result: unknown[], record: QualityRuleFileEntry): boolean {
  if (typeof record["id"] !== "number" || (!("name" in record) && !("nickname" in record))) {
    return false;
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
  return true;
}

/**
 * 外部规则文件只承载用户可维护字段，内部行身份由页面和统计链路自行补齐。
 */
function push_normalized_rule(result: unknown[], entry: QualityRuleFileEntry): void {
  const normalized = normalize_external_rule(entry);
  if (normalized["src"] !== "") {
    result.push(normalized);
  }
}

/** JSON 数组只投影外部可维护字段，字段值留给具体规则边界校验。 */
function project_external_rule_fields(entry: QualityRuleFileEntry): QualityRuleFileEntry {
  const result: QualityRuleFileEntry = {};
  for (const key of ["src", "dst", "info", "regex", "case_sensitive"] as const) {
    if (Object.hasOwn(entry, key)) {
      result[key] = entry[key]!; // 自有 JSON 字段的值不会是 undefined。
    }
  }
  return result;
}

/** 导出只保留规则的可编辑字段，并补齐空值。 */
function normalize_external_rule(entry: QualityRuleFileEntry): QualityRuleFileEntry {
  return {
    src: String(entry["src"] ?? "").trim(),
    dst: String(entry["dst"] ?? "").trim(),
    info: String(entry["info"] ?? "").trim(),
    regex: Boolean(entry["regex"] ?? false),
    case_sensitive: Boolean(entry["case_sensitive"] ?? false),
  };
}
