import type { ApiJsonValue } from "../api/api-types";

/**
 * 文件条目状态沿用 Python ItemStatus 字面量，避免跨栈传输时再做映射表。
 */
export type FileItemStatus =
  | "NONE"
  | "PROCESSED"
  | "ERROR"
  | "EXCLUDED"
  | "RULE_SKIPPED"
  | "LANGUAGE_SKIPPED"
  | "DUPLICATED";

/**
 * 文件格式类型与 Core Item.FileType 保持同名，TS 侧只补充已迁移的公开解析入口。
 */
export type FileItemType =
  | "NONE"
  | "MD"
  | "TXT"
  | "SRT"
  | "ASS"
  | "EPUB"
  | "XLSX"
  | "WOLFXLSX"
  | "RENPY"
  | "TRANS"
  | "KVJSON"
  | "MESSAGEJSON";

/**
 * 文本类型用于后续规则、语言和引擎过滤，不等同于物理文件格式。
 */
export type FileTextType = "NONE" | "MD" | "KAG" | "WOLF" | "RENPY" | "RPGMAKER";

/**
 * TS 文件处理器之间传递的规范条目；字段名保持 Python `Item.to_dict()` 兼容。
 */
export interface FileFormatItem {
  id?: number;
  src: string;
  dst: string;
  name_src?: string | string[] | null;
  name_dst?: string | string[] | null;
  extra_field: ApiJsonValue;
  tag: string;
  row: number;
  file_type: FileItemType;
  file_path: string;
  text_type: FileTextType;
  status: FileItemStatus;
  retry_count: number;
}

const VALID_STATUS = new Set<FileItemStatus>([
  "NONE",
  "PROCESSED",
  "ERROR",
  "EXCLUDED",
  "RULE_SKIPPED",
  "LANGUAGE_SKIPPED",
  "DUPLICATED",
]);

const VALID_FILE_TYPE = new Set<FileItemType>([
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
]);

const VALID_TEXT_TYPE = new Set<FileTextType>(["NONE", "MD", "KAG", "WOLF", "RENPY", "RPGMAKER"]);

// 这些启发式只用于 Py 侧同款兜底推断，不能替代具体格式处理器的 text_type。
const WOLF_PATTERNS = [/@\d+/iu, /\\[cus]db\[.+?:.+?:.+?\]/iu];
const RPGMAKER_PATTERNS = [
  /en\(.{0,8}[vs]\[\d+\].{0,16}\)/iu,
  /if\(.{0,8}[vs]\[\d+\].{0,16}\)/iu,
  /[/\\][a-z]{1,8}[<[][a-z\d]{0,16}[>\]]/iu,
];
const RENPY_PATTERNS = [/\{[^{\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]*?\}/iu];

/**
 * 将外部 JSON 或数据库行收敛成稳定 FileFormatItem，避免格式处理器重复防御字段缺失。
 */
export function normalize_file_item(payload: Partial<FileFormatItem>): FileFormatItem {
  const src = String(payload.src ?? "");
  const file_type = normalize_file_type(payload.file_type);
  let text_type = normalize_text_type(payload.text_type);
  if (
    text_type === "NONE" &&
    (file_type === "XLSX" || file_type === "KVJSON" || file_type === "MESSAGEJSON")
  ) {
    text_type = infer_text_type(src);
  }
  return {
    src,
    dst: String(payload.dst ?? ""),
    name_src: normalize_name(payload.name_src),
    name_dst: normalize_name(payload.name_dst),
    extra_field: (payload.extra_field ?? "") as ApiJsonValue,
    tag: String(payload.tag ?? ""),
    row: normalize_number(payload.row, 0),
    file_type,
    file_path: String(payload.file_path ?? ""),
    text_type,
    status: normalize_status(payload.status),
    retry_count: normalize_number(payload.retry_count, 0),
    ...(payload.id === undefined ? {} : { id: normalize_number(payload.id, 0) }),
  };
}

/**
 * 写回 API 响应和 golden 对拍都走同一 JSON 形状，避免可选字段产生跨栈漂移。
 */
export function item_to_json(item: FileFormatItem): Record<string, ApiJsonValue> {
  const payload: Record<string, ApiJsonValue> = {
    src: item.src,
    dst: item.dst,
    name_src: normalize_name(item.name_src) as ApiJsonValue,
    name_dst: normalize_name(item.name_dst) as ApiJsonValue,
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

/**
 * 导出时优先使用译文，未处理条目回落原文，保持 Py 写回口径。
 */
export function effective_dst(item: FileFormatItem): string {
  return item.dst !== "" ? item.dst : item.src;
}

/**
 * 兼容历史状态名，同时把未知状态收敛为可继续处理的 NONE。
 */
export function normalize_status(value: unknown): FileItemStatus {
  if (value === "PROCESSED_IN_PAST") {
    return "PROCESSED";
  }
  if (value === "PROCESSING") {
    return "NONE";
  }
  return VALID_STATUS.has(value as FileItemStatus) ? (value as FileItemStatus) : "NONE";
}

/**
 * 文件类型只接受已知枚举，防止数据库旧值污染导出分发。
 */
export function normalize_file_type(value: unknown): FileItemType {
  return VALID_FILE_TYPE.has(value as FileItemType) ? (value as FileItemType) : "NONE";
}

/**
 * 文本类型只接受规则层理解的枚举，未知值统一退回 NONE。
 */
export function normalize_text_type(value: unknown): FileTextType {
  return VALID_TEXT_TYPE.has(value as FileTextType) ? (value as FileTextType) : "NONE";
}

/**
 * name 字段允许字符串、字符串数组或空值，导出前必须先规范化。
 */
export function normalize_name(value: unknown): string | string[] | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return typeof value === "string" ? value : String(value);
}

/**
 * JSON 记录读取统一兜底为空对象，避免调用点到处散落 object/null/array 判断。
 */
export function read_json_record(value: unknown): Record<string, ApiJsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, ApiJsonValue>)
    : {};
}

/**
 * 数字字段来自 JSON/SQLite 时可能是浮点或缺失，这里统一截断成整数。
 */
function normalize_number(value: unknown, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

/**
 * 只有缺少显式 text_type 的通用表格 / JSON 格式才需要根据原文推断引擎类型。
 */
function infer_text_type(src: string): FileTextType {
  if (WOLF_PATTERNS.some((pattern) => pattern.test(src))) {
    return "WOLF";
  }
  if (RPGMAKER_PATTERNS.some((pattern) => pattern.test(src))) {
    return "RPGMAKER";
  }
  if (RENPY_PATTERNS.some((pattern) => pattern.test(src))) {
    return "RENPY";
  }
  return "NONE";
}
