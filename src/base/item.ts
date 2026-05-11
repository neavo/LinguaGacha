import { has_language_character } from "../shared/rules/languages";
import type { JsonRecord, JsonValue } from "./json";

// Item 状态沿用公开载荷和 .lg 历史事实，所有兼容旧值的折叠都在本文件收口。
export const ITEM_STATUSES = [
  "NONE",
  "PROCESSED",
  "ERROR",
  "EXCLUDED",
  "RULE_SKIPPED",
  "LANGUAGE_SKIPPED",
  "DUPLICATED",
] as const;

// ItemFileType 表示来源文件格式，不等同于后续规则和引擎消费的 text_type。
export const ITEM_FILE_TYPES = [
  "NONE",
  "MD",
  "TXT",
  "SRT",
  "ASS",
  "EPUB",
  "XLSX",
  "WOLFXLSX",
  "RENPY",
  "TRANS",
  "KVJSON",
  "MESSAGEJSON",
] as const;

// ItemTextType 表示文本规则语义，导出和过滤逻辑不能混入物理文件格式枚举。
export const ITEM_TEXT_TYPES = ["NONE", "MD", "KAG", "WOLF", "RENPY", "RPGMAKER"] as const;

export type ItemStatus = (typeof ITEM_STATUSES)[number];
export type ItemFileType = (typeof ITEM_FILE_TYPES)[number];
export type ItemTextType = (typeof ITEM_TEXT_TYPES)[number];

export interface Item {
  id?: number;
  src: string;
  dst: string;
  name_src?: string | string[] | null;
  name_dst?: string | string[] | null;
  extra_field: JsonValue;
  tag: string;
  row: number;
  file_type: ItemFileType;
  file_path: string;
  text_type: ItemTextType;
  status: ItemStatus;
  retry_count: number;
}

const ITEM_STATUS_SET = new Set<ItemStatus>(ITEM_STATUSES);
const ITEM_FILE_TYPE_SET = new Set<ItemFileType>(ITEM_FILE_TYPES);
const ITEM_TEXT_TYPE_SET = new Set<ItemTextType>(ITEM_TEXT_TYPES);
const TEXT_TYPE_INFERENCE_FILE_TYPES = new Set<ItemFileType>(["XLSX", "KVJSON", "MESSAGEJSON"]);

// 这些启发式只用于旧实现同款兜底推断，不能替代具体格式处理器的 text_type。
const WOLF_PATTERNS = [/@\d+/iu, /\\[cus]db\[.+?:.+?:.+?\]/iu];

const RPGMAKER_PATTERNS = [
  /en\(.{0,8}[vs]\[\d+\].{0,16}\)/iu,
  /if\(.{0,8}[vs]\[\d+\].{0,16}\)/iu,
  /[/\\][a-z]{1,8}[<[][a-z\d]{0,16}[>\]]/iu,
];

// Ren'Py 控制标签检测复用全局正则，每次调用必须重置游标。
const RENPY_CONTROL_TAG_PATTERN = /\{([^{}]*?)\}|\[([^[\]]*?)\]/giu;

// item 状态从数据库、API 和任务进度多处流入，先判定再统计。
export function is_item_status(value: unknown): value is ItemStatus {
  return ITEM_STATUS_SET.has(value as ItemStatus);
}

// 文件格式只表示解析来源，不能用它替代文本规则语义。
export function is_item_file_type(value: unknown): value is ItemFileType {
  return ITEM_FILE_TYPE_SET.has(value as ItemFileType);
}

// 文本规则语义用于过滤和保护规则，来源于格式处理器或兜底推断。
export function is_item_text_type(value: unknown): value is ItemTextType {
  return ITEM_TEXT_TYPE_SET.has(value as ItemTextType);
}

// normalize_item 是旧 payload、数据库行和格式处理器输出进入统一 item 形状的入口。
export function normalize_item(payload: Partial<Item>): Item {
  const src = String(payload.src ?? "");
  const file_type = normalize_item_file_type(payload.file_type);
  let text_type = normalize_item_text_type(payload.text_type);
  if (text_type === "NONE" && TEXT_TYPE_INFERENCE_FILE_TYPES.has(file_type)) {
    text_type = infer_item_text_type_from_source(src);
  }
  return {
    src,
    dst: String(payload.dst ?? ""),
    name_src: normalize_item_name(payload.name_src),
    name_dst: normalize_item_name(payload.name_dst),
    extra_field: payload.extra_field ?? "",
    tag: String(payload.tag ?? ""),
    row: normalize_item_number(payload.row, 0),
    file_type,
    file_path: String(payload.file_path ?? ""),
    text_type,
    status: normalize_item_status(payload.status),
    retry_count: normalize_item_number(payload.retry_count, 0),
    ...(payload.id === undefined ? {} : { id: normalize_item_number(payload.id, 0) }),
  };
}

// item_to_json 固定公开字段顺序，让 API、测试 golden 和文件域写回使用同一形状。
export function item_to_json(item: Item): JsonRecord {
  const payload: JsonRecord = {
    src: item.src,
    dst: item.dst,
    name_src: normalize_item_name(item.name_src) as JsonValue,
    name_dst: normalize_item_name(item.name_dst) as JsonValue,
    extra_field: item.extra_field,
    tag: item.tag,
    row: item.row,
    file_type: item.file_type,
    file_path: item.file_path,
    text_type: item.text_type,
    status: item.status,
    retry_count: item.retry_count,
  };
  if (item.id !== undefined) {
    payload["id"] = item.id;
  }
  return payload;
}

// 导出只关心最终可写文本，空译文按历史行为回退原文。
export function resolve_item_effective_dst(item: Item): string {
  return item.dst !== "" ? item.dst : item.src;
}

// 历史运行中状态不能泄漏到当前运行态，打开旧工程和读取旧 payload 都在这里折叠。
export function normalize_item_status(value: unknown): ItemStatus {
  if (value === "PROCESSED_IN_PAST") {
    return "PROCESSED";
  }
  if (value === "PROCESSING") {
    return "NONE";
  }
  return is_item_status(value) ? value : "NONE";
}

// 未知文件格式折叠为 NONE，由调用点决定是否继续处理该 item。
export function normalize_item_file_type(value: unknown): ItemFileType {
  return is_item_file_type(value) ? value : "NONE";
}

// 未知文本规则语义折叠为 NONE，避免误触发某类脚本保护规则。
export function normalize_item_text_type(value: unknown): ItemTextType {
  return is_item_text_type(value) ? value : "NONE";
}

// 名称字段兼容字符串和多列名称数组，非法项在边界处剔除。
export function normalize_item_name(value: unknown): string | string[] | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return typeof value === "string" ? value : String(value);
}

// extra_field 等弱类型 JSON 载荷必须先确认对象形状再读取。
export function read_json_record(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

// 旧格式兜底推断只在缺失 text_type 时运行，不能覆盖格式处理器的显式结果。
export function infer_item_text_type_from_source(src: string): ItemTextType {
  if (WOLF_PATTERNS.some((pattern) => pattern.test(src))) {
    return "WOLF";
  }
  if (RPGMAKER_PATTERNS.some((pattern) => pattern.test(src))) {
    return "RPGMAKER";
  }
  if (has_renpy_control_tag(src)) {
    return "RENPY";
  }
  return "NONE";
}

// Ren'Py 控制标签内不含日韩文本时才视为语法标签，避免误判正文括号。
function has_renpy_control_tag(src: string): boolean {
  RENPY_CONTROL_TAG_PATTERN.lastIndex = 0;
  for (const match of src.matchAll(RENPY_CONTROL_TAG_PATTERN)) {
    const body = String(match[1] ?? match[2] ?? "");
    if (!has_language_character(body, "JA") && !has_language_character(body, "KO")) {
      RENPY_CONTROL_TAG_PATTERN.lastIndex = 0;
      return true;
    }
  }
  RENPY_CONTROL_TAG_PATTERN.lastIndex = 0;
  return false;
}

// 数值字段来自 JSON 和 SQLite，统一截断为整数并保留调用方回退值。
function normalize_item_number(value: unknown, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}
