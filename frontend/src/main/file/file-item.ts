import type { ApiJsonValue } from "../api/api-types";
import { infer_text_type_from_source } from "./file-text-type-inference";

/**
 * 文件条目状态沿用 历史 ItemStatus 字面量，避免跨栈传输时再做映射表。
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
 * TS 文件处理器之间传递的规范条目；字段名保持 历史 item 字典 兼容。
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

// 状态白名单在反序列化入口收口，兼容旧状态名后再交给格式处理器。
const VALID_STATUS = new Set<FileItemStatus>([
  "NONE",
  "PROCESSED",
  "ERROR",
  "EXCLUDED",
  "RULE_SKIPPED",
  "LANGUAGE_SKIPPED",
  "DUPLICATED",
]);

// 物理文件类型白名单集中在入口规范化层，格式处理器只接收已知值。
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

// text_type 只描述规则/引擎语义，不能混入文件格式枚举。
const VALID_TEXT_TYPE = new Set<FileTextType>(["NONE", "MD", "KAG", "WOLF", "RENPY", "RPGMAKER"]);

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
    text_type = infer_text_type_from_source(src);
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
 * 导出时优先使用译文，未处理条目回落原文，保持 旧写回口径。
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
