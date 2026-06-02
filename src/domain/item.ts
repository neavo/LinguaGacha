import { has_language_character } from "./language";
import type { JsonRecord, JsonValue } from "../shared/utils/json-tool";

// 条目状态
/**
 * 集中维护当前模块的稳定常量。
 */
export const ITEM_STATUSES = [
  "NONE",
  "PROCESSED",
  "ERROR",
  "EXCLUDED",
  "RULE_SKIPPED",
  "LANGUAGE_SKIPPED",
  "DUPLICATED",
] as const;

// 文件的类型
/**
 * 集中维护当前模块的稳定常量。
 */
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

/**
 * 集中维护当前模块的稳定常量。
 */
export const ITEM_TEXT_TYPES = ["NONE", "MD", "KAG", "WOLF", "RENPY", "RPGMAKER"] as const; // 文本的实际类型

export type ItemStatus = (typeof ITEM_STATUSES)[number];
export type ItemFileType = (typeof ITEM_FILE_TYPES)[number];
export type ItemTextType = (typeof ITEM_TEXT_TYPES)[number];
export type ItemNameField = string | string[] | null;

// renderer 与公开 API 共享的完整 item DTO，字段名避开数据库内部 id/row
export type ProjectItemPublicRecord = {
  item_id: number; // 公开 item 主键
  src: string; // 原文
  dst: string; // 译文
  name_src: ItemNameField; // 角色姓名原文
  name_dst: ItemNameField; // 角色姓名译文
  extra_field: JsonValue; // 格式私有扩展字段
  tag: string; // 标签
  row_number: number; // 公开行号
  file_type: ItemFileType; // 文件格式
  file_path: string; // 项目内相对路径
  text_type: ItemTextType; // 文本规则类型
  status: ItemStatus; // 翻译状态
  retry_count: number; // 重试次数
  skip_internal_filter: boolean; // 是否绕过内部过滤
};

// 写回 .lg 前使用的完整持久 item DTO，字段名保持数据库层 id/row 口径
export type ProjectItemPersistentRecord = JsonRecord & {
  id: number; // 数据库 item 主键
  src: string; // 原文
  dst: string; // 译文
  name_src: ItemNameField; // 角色姓名原文
  name_dst: ItemNameField; // 角色姓名译文
  extra_field: JsonValue; // 格式私有扩展字段
  tag: string; // 标签
  row: number; // 数据库行号
  file_type: ItemFileType; // 文件格式
  file_path: string; // 项目内相对路径
  text_type: ItemTextType; // 文本规则类型
  status: ItemStatus; // 翻译状态
  retry_count: number; // 重试次数
  skip_internal_filter: boolean; // 是否绕过内部过滤
};

const ITEM_STATUS_SET = new Set<ItemStatus>(ITEM_STATUSES);
const ITEM_FILE_TYPE_SET = new Set<ItemFileType>(ITEM_FILE_TYPES);
const ITEM_TEXT_TYPE_SET = new Set<ItemTextType>(ITEM_TEXT_TYPES);
const TEXT_TYPE_INFERENCE_FILE_TYPES = new Set<ItemFileType>(["XLSX", "KVJSON", "MESSAGEJSON"]);
// 全量公开写回必须携带这些稳定字段，避免页面层用默认值覆盖真实持久事实
const PROJECT_ITEM_PUBLIC_REQUIRED_FIELDS = [
  "src",
  "dst",
  "name_src",
  "name_dst",
  "extra_field",
  "tag",
  "file_type",
  "file_path",
  "text_type",
  "status",
  "retry_count",
  "skip_internal_filter",
] as const;

// WOLF
const WOLF_PATTERNS = [
  /@\d+/iu, // 角色 ID
  /\\[cus]db\[.+?:.+?:.+?\]/iu, // 数据库变量 \cdb[0:1:2]
];

// RPGMaker
const RPGMAKER_PATTERNS = [
  /en\(.{0,8}[vs]\[\d+\].{0,16}\)/iu, // en(!s[982]) en(v[982] >= 1)
  /if\(.{0,8}[vs]\[\d+\].{0,16}\)/iu, // if(!s[982]) if(v[982] >= 1)
  /[/\\][a-z]{1,8}[<[][a-z\d]{0,16}[>\]]/iu, // /c[xy12] \bc[xy12] <\bc[xy12]>
];

const RENPY_CONTROL_TAG_PATTERN = /\{([^{}]*?)\}|\[([^[\]]*?)\]/giu; // RENPY；合并 Py 侧花括号和方括号两组控制标签检测，每次调用必须重置游标

/**
 * Item 是跨文件解析、数据库、任务和导出共享的条目实体
 */
export class Item {
  public id?: number; // 数据库主键（自增）；跨层 JSON 中允许缺失
  public src = ""; // 原文
  public dst = ""; // 译文；为空时导出逻辑回退原文
  public name_src: ItemNameField = null; // 角色姓名原文
  public name_dst: ItemNameField = null; // 角色姓名译文
  public extra_field: JsonValue = ""; // 额外字段原文；兼容格式私有 JSON
  public tag = ""; // 标签
  public row = 0; // 行号
  public file_type: ItemFileType = "NONE"; // 文件的类型
  public file_path = ""; // 文件的相对路径
  public text_type: ItemTextType = "NONE"; // 文本的实际类型
  public status: ItemStatus = "NONE"; // 翻译状态
  public retry_count = 0; // 重试次数，当前只有单独重试的时候才增加此计数
  public skip_internal_filter = false; // 强制翻译条目绕过规则/语言类内部过滤

  /**
   * 初始化当前实例的内部状态。
   */
  private constructor() {}

  /**
   * 反序列化数据库行和格式处理器输出，统一补齐 item 值域
   */
  public static from_json(payload: unknown): Item {
    const record = read_json_record(payload);
    const src = String(record["src"] ?? "");
    const file_type = Item.normalize_file_type(record["file_type"]);
    let text_type = Item.normalize_text_type(record["text_type"]);
    if (text_type === "NONE" && TEXT_TYPE_INFERENCE_FILE_TYPES.has(file_type)) {
      text_type = Item.infer_text_type_from_source(src);
    }
    const item = new Item();
    item.id = record["id"] === undefined ? undefined : normalize_item_number(record["id"], 0);
    item.src = src;
    item.dst = String(record["dst"] ?? "");
    item.name_src = Item.normalize_name_field(record["name_src"]);
    item.name_dst = Item.normalize_name_field(record["name_dst"]);
    item.extra_field = (record["extra_field"] ?? "") as JsonValue;
    item.tag = String(record["tag"] ?? "");
    item.row = normalize_item_number(record["row"] ?? record["row_number"], 0);
    item.file_type = file_type;
    item.file_path = String(record["file_path"] ?? "");
    item.text_type = text_type;
    item.status = Item.normalize_status(record["status"]);
    item.retry_count = normalize_item_number(record["retry_count"], 0);
    item.skip_internal_filter = record["skip_internal_filter"] === true;
    return item;
  }

  /**
   * 固定公开字段顺序，让 API、测试 golden 和文件域写回使用同一形状
   */
  public to_json(): JsonRecord {
    const payload: JsonRecord = {
      src: this.src,
      dst: this.dst,
      name_src: Item.normalize_name_field(this.name_src) as JsonValue,
      name_dst: Item.normalize_name_field(this.name_dst) as JsonValue,
      extra_field: this.extra_field,
      tag: this.tag,
      row: this.row,
      file_type: this.file_type,
      file_path: this.file_path,
      text_type: this.text_type,
      status: this.status,
      retry_count: this.retry_count,
      skip_internal_filter: this.skip_internal_filter,
    };
    if (this.id !== undefined) {
      payload["id"] = this.id;
    }
    return payload;
  }

  /**
   * 将持久 item 或公开 item 转成 renderer 可缓存的完整公开 DTO。
   */
  public to_public_json(): ProjectItemPublicRecord {
    return {
      item_id: this.id ?? 0,
      src: this.src,
      dst: this.dst,
      name_src: Item.normalize_name_field(this.name_src),
      name_dst: Item.normalize_name_field(this.name_dst),
      extra_field: this.extra_field,
      tag: this.tag,
      row_number: this.row,
      file_type: this.file_type,
      file_path: this.file_path,
      text_type: this.text_type,
      status: this.status,
      retry_count: this.retry_count,
      skip_internal_filter: this.skip_internal_filter,
    };
  }

  /**
   * 导出只关心最终可写文本，空译文回退原文
   */
  public effective_dst(): string {
    return this.dst !== "" ? this.dst : this.src;
  }

  /**
   * 将输入收窄为当前条目状态，非法值按未处理状态兜底
   */
  public static normalize_status(value: unknown): ItemStatus {
    return is_item_status(value) ? value : "NONE";
  }

  /**
   * 未知文件格式折叠为 NONE，由调用点决定是否继续处理该 item
   */
  public static normalize_file_type(value: unknown): ItemFileType {
    return is_item_file_type(value) ? value : "NONE";
  }

  /**
   * 未知文本规则语义折叠为 NONE，避免误触发某类脚本保护规则
   */
  public static normalize_text_type(value: unknown): ItemTextType {
    return is_item_text_type(value) ? value : "NONE";
  }

  /**
   * 名称字段兼容字符串和多列名称数组，非法项在边界处剔除
   */
  public static normalize_name_field(value: unknown): ItemNameField {
    if (value === undefined || value === null) {
      return null;
    }
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === "string");
    }
    return typeof value === "string" ? value : String(value);
  }

  /**
   * text_type 兜底推断只在缺失时运行，不能覆盖格式处理器的显式结果
   */
  public static infer_text_type_from_source(src: string): ItemTextType {
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
}

// item 状态从数据库、API 和任务进度多处流入，先判定再统计
/**
 * 判断当前值是否满足业务条件。
 */
export function is_item_status(value: unknown): value is ItemStatus {
  return ITEM_STATUS_SET.has(value as ItemStatus);
}

// 文件格式只表示解析来源，不能用它替代文本规则语义
/**
 * 判断当前值是否满足业务条件。
 */
export function is_item_file_type(value: unknown): value is ItemFileType {
  return ITEM_FILE_TYPE_SET.has(value as ItemFileType);
}

// 文本规则语义用于过滤和保护规则，来源于格式处理器或兜底推断
/**
 * 判断当前值是否满足业务条件。
 */
export function is_item_text_type(value: unknown): value is ItemTextType {
  return ITEM_TEXT_TYPE_SET.has(value as ItemTextType);
}

// extra_field 等弱类型 JSON 载荷必须先确认对象形状再读取
/**
 * 读取当前场景需要的稳定数据。
 */
export function read_json_record(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

// 完整公开 DTO 必须显式携带所有持久字段；字段缺失只能由 migration 处理
/**
 * 读取当前场景需要的稳定数据。
 */
export function collect_project_item_missing_public_fields(value: unknown): string[] {
  const record = read_json_record(value);
  const missing_fields: string[] = [];
  if (record["item_id"] === undefined && record["id"] === undefined) {
    missing_fields.push("item_id");
  }
  if (record["row_number"] === undefined && record["row"] === undefined) {
    missing_fields.push("row_number");
  }
  for (const field of PROJECT_ITEM_PUBLIC_REQUIRED_FIELDS) {
    if (record[field] === undefined) {
      missing_fields.push(field);
    }
  }
  return missing_fields;
}

// API 和项目 query 只使用 item_id/row_number，id/row 只在边界转换时短暂出现
/**
 * 归一化输入，保证下游消费稳定形状。
 */
export function normalize_project_item_public_record(
  value: unknown,
): ProjectItemPublicRecord | null {
  const record = read_json_record(value);
  if (collect_project_item_missing_public_fields(record).length > 0) {
    return null;
  }
  const item_id = normalize_item_number(record["item_id"] ?? record["id"], 0);
  if (!Number.isInteger(item_id) || item_id <= 0) {
    return null;
  }
  const item = Item.from_json({
    ...record,
    id: item_id,
    row: record["row"] ?? record["row_number"],
  });
  item.id = item_id;
  return item.to_public_json();
}

// 全量写库入口统一把公开 DTO 转回持久字段，避免页面层手写 id/row 映射
/**
 * 归一化输入，保证下游消费稳定形状。
 */
export function normalize_project_item_persistent_record(
  value: unknown,
): ProjectItemPersistentRecord | null {
  const public_record = normalize_project_item_public_record(value);
  if (public_record === null) {
    return null;
  }
  const item = Item.from_json({
    id: public_record.item_id,
    src: public_record.src,
    dst: public_record.dst,
    name_src: public_record.name_src,
    name_dst: public_record.name_dst,
    extra_field: public_record.extra_field,
    tag: public_record.tag,
    row: public_record.row_number,
    file_type: public_record.file_type,
    file_path: public_record.file_path,
    text_type: public_record.text_type,
    status: public_record.status,
    retry_count: public_record.retry_count,
    skip_internal_filter: public_record.skip_internal_filter,
  });
  return item.to_json() as ProjectItemPersistentRecord;
}

// 数值字段来自 JSON 和 SQLite，统一截断为整数并保留调用方回退值
/**
 * 归一化输入，保证下游消费稳定形状。
 */
function normalize_item_number(value: unknown, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

// Ren'Py 控制标签内不含日韩文本时才视为语法标签，避免误判正文括号
/**
 * 判断当前值是否满足业务条件。
 */
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
