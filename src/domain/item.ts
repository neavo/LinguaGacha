import { Type, type Static } from "typebox";
import { Check } from "typebox/value";
import { Compile } from "typebox/compile";
import { has_language_character } from "./language";
import { JSON_VALUE_SCHEMA, read_json_record, read_json_integer } from "./json";

// 条目状态
export const ITEM_STATUSES = [
  "NONE",
  "PROCESSED",
  "ERROR",
  "EXCLUDED",
  "RULE_SKIPPED",
  "LANGUAGE_SKIPPED",
  "DUPLICATED",
] as const;

/** GUI 与 Agent 提交人工状态。其余状态由工程写入或任务维护。 */
export const ITEM_MANUAL_STATUSES = ["NONE", "PROCESSED", "EXCLUDED"] as const;

// 文件的类型
export const ITEM_FILE_TYPES = [
  "NONE",
  "MD_V2",
  "TXT",
  "SRT",
  "ASS",
  "VTT",
  "LRC",
  "EPUB",
  "XLSX",
  "WOLFXLSX",
  "RENPY",
  "TRANS",
  "KVJSON",
  "MESSAGEJSON",
] as const;

export const ITEM_TEXT_TYPES = ["NONE", "MD", "KAG", "WOLF", "RENPY", "RPGMAKER"] as const; // 文本的实际类型

const ITEM_NAME_SCHEMA = Type.Union([Type.String(), Type.Array(Type.String()), Type.Null()]); // 数组第 0 槽为可见姓名，其余槽位保留格式信息。
/** 条目形状共用业务字段，身份和行号由各自边界补充。 */
const ITEM_BUSINESS_SCHEMA = Type.Object({
  src: Type.String(), // 正文原文。
  dst: Type.String(), // 正文译文，空字符串在生成时结合状态和格式处理。
  name_src: ITEM_NAME_SCHEMA, // 角色姓名原文。
  name_dst: ITEM_NAME_SCHEMA, // 角色姓名译文。
  extra_field: JSON_VALUE_SCHEMA, // 随条目持久化的格式私有扩展数据。
  tag: Type.String(), // 格式标签或资产内部定位信息。
  file_type: Type.Enum(ITEM_FILE_TYPES), // 解析来源格式，决定导出处理器。
  file_path: Type.String(), // 工程内相对路径，对应原始资产。
  text_type: Type.Enum(ITEM_TEXT_TYPES), // 文本规则类型，用于脚本过滤和保护。
  status: Type.Enum(ITEM_STATUSES), // 条目处理状态，用于统计和译文生成。
  skip_internal_filter: Type.Boolean(), // 本条目是否跳过规则和语言过滤。
});
/** 格式解析尚未分配身份，迁移也可使用临时身份。 */
const ITEM_SCHEMA = Type.Object({
  id: Type.Optional(Type.Integer()), // 解析时可缺省，迁移可使用临时身份。
  ...ITEM_BUSINESS_SCHEMA.properties,
  row: Type.Integer(), // 格式处理器提供的条目位置，用于排序和写回。
});
const PROJECT_ITEM_PERSISTENT_SCHEMA = Type.Object({
  ...ITEM_BUSINESS_SCHEMA.properties,
  id: Type.Integer({ minimum: 1 }), // 已持久化条目的数据库主键。
  row: ITEM_SCHEMA.properties.row, // 持久定位字段，保留格式处理器的位置语义。
});
export const PROJECT_ITEM_PUBLIC_SCHEMA = Type.Object({
  ...ITEM_BUSINESS_SCHEMA.properties,
  item_id: PROJECT_ITEM_PERSISTENT_SCHEMA.properties.id, // 公开条目主键，对应存储字段 `id`。
  row_number: ITEM_SCHEMA.properties.row, // 公开定位字段，对应存储字段 `row`。
});
/** 完整替换也接受待分配身份的条目，已提供的身份必须是正整数。 */
export const PROJECT_ITEM_WRITE_SCHEMA = Type.Object({
  ...PROJECT_ITEM_PERSISTENT_SCHEMA.properties,
  id: Type.Optional(PROJECT_ITEM_PERSISTENT_SCHEMA.properties.id), // 新条目可由数据库分配主键。
});
/** 人工姓名是第 0 槽的字符串视图，提交 patch 仍携带完整姓名字段。 */
export const PROJECT_ITEM_MANUAL_UPDATE_SCHEMA = Type.Object(
  {
    dst: Type.Optional(ITEM_BUSINESS_SCHEMA.properties.dst), // 人工确认的正文译文，允许空字符串。
    name_dst: Type.Optional(Type.String()), // 姓名第 0 槽的人工译文。
    status: Type.Optional(Type.Enum(ITEM_MANUAL_STATUSES)), // 显式人工状态，优先于内容修改的默认完成状态。
  },
  { additionalProperties: false, minProperties: 1 },
);
export type Item = Static<typeof ITEM_SCHEMA>;
export type ItemNameField = Static<typeof ITEM_NAME_SCHEMA>;
export type ProjectItemPublicRecord = Static<typeof PROJECT_ITEM_PUBLIC_SCHEMA>;
export type ProjectItemPersistentRecord = Static<typeof PROJECT_ITEM_PERSISTENT_SCHEMA>;

export type ItemStatus = Item["status"];
export type ItemManualStatus = (typeof ITEM_MANUAL_STATUSES)[number];
export type ItemFileType = Item["file_type"];
export type ItemTextType = Item["text_type"];
const ITEM_STATUS_SET = new Set<ItemStatus>(ITEM_STATUSES);
const ITEM_MANUAL_STATUS_SET = new Set<ItemManualStatus>(ITEM_MANUAL_STATUSES);
const ITEM_FILE_TYPE_SET = new Set<ItemFileType>(ITEM_FILE_TYPES);
const PROJECT_ITEM_PUBLIC_VALIDATOR = Compile(PROJECT_ITEM_PUBLIC_SCHEMA); // 复用编译结果，避免逐条解释格式私有数据。
const TEXT_TYPE_INFERENCE_FILE_TYPES = new Set<ItemFileType>(["XLSX", "KVJSON", "MESSAGEJSON"]);
const WOLF_PATTERNS = [
  /@\d+/iu, // 角色 ID
  /\\[cus]db\[.+?:.+?:.+?\]/iu, // 数据库变量 \cdb[0:1:2]
];
const RPGMAKER_PATTERNS = [
  /en\(.{0,8}[vs]\[\d+\].{0,16}\)/iu, // en(!s[982]) en(v[982] >= 1)
  /if\(.{0,8}[vs]\[\d+\].{0,16}\)/iu, // if(!s[982]) if(v[982] >= 1)
  /[/\\][a-z]{1,8}[<[][a-z\d]{0,16}[>\]]/iu, // /c[xy12] \bc[xy12] <\bc[xy12]>
];
const RENPY_CONTROL_TAG_PATTERN = /\{([^{}]*?)\}|\[([^[\]]*?)\]/giu;

const DEFAULT_ITEM: Omit<Item, "id"> = {
  src: "",
  dst: "",
  name_src: null,
  name_dst: null,
  extra_field: "",
  tag: "",
  row: 0,
  file_type: "NONE",
  file_path: "",
  text_type: "NONE",
  status: "NONE",
  skip_internal_filter: false,
};
/** 格式输入与历史 JSON 在此补齐字段，已收窄的内部条目直接传递。 */
export function create_item(payload: unknown = {}): Item {
  const record = read_json_record(payload);
  const src = String(record["src"] ?? DEFAULT_ITEM.src);
  const file_type = normalize_item_file_type(record["file_type"]);
  let text_type = normalize_item_text_type(record["text_type"]);
  if (text_type === "NONE" && TEXT_TYPE_INFERENCE_FILE_TYPES.has(file_type)) {
    text_type = infer_item_text_type_from_source(src);
  }
  return {
    ...(record["id"] === undefined ? {} : { id: read_json_integer(record["id"], 0) }),
    src,
    dst: String(record["dst"] ?? DEFAULT_ITEM.dst),
    name_src: normalize_item_name_field(record["name_src"]),
    name_dst: normalize_item_name_field(record["name_dst"]),
    extra_field: record["extra_field"] ?? DEFAULT_ITEM.extra_field,
    tag: String(record["tag"] ?? DEFAULT_ITEM.tag),
    row: read_json_integer(record["row"] ?? record["row_number"], DEFAULT_ITEM.row),
    file_type,
    file_path: String(record["file_path"] ?? DEFAULT_ITEM.file_path),
    text_type,
    status: normalize_item_status(record["status"]),
    skip_internal_filter: record["skip_internal_filter"] === true,
  };
}
/** 字段名转换只发生在公开与存储边界。 */
export function build_project_item_public_record(item: Item): ProjectItemPublicRecord {
  const { id, row, ...fields } = item;
  return {
    ...fields,
    name_src: structuredClone(fields.name_src),
    name_dst: structuredClone(fields.name_dst),
    item_id: id ?? 0,
    row_number: row,
  };
}

/** 历史条目中的未知状态按未处理条目继续。 */
export function normalize_item_status(value: unknown): ItemStatus {
  return is_item_status(value) ? value : DEFAULT_ITEM.status;
}

/**
 * 未知文件格式折叠为 NONE，由调用点决定是否继续处理该 item
 */
export function normalize_item_file_type(value: unknown): ItemFileType {
  return is_item_file_type(value) ? value : DEFAULT_ITEM.file_type;
}

/**
 * 未知文本规则语义折叠为 NONE，避免误触发某类脚本保护规则
 */
export function normalize_item_text_type(value: unknown): ItemTextType {
  return is_item_text_type(value) ? value : DEFAULT_ITEM.text_type;
}

/**
 * 名称字段兼容字符串和多列名称数组，非法项在边界处剔除
 */
export function normalize_item_name_field(value: unknown): ItemNameField {
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

// item 状态从数据库、API 和任务进度多处流入，先判定再统计
export function is_item_status(value: unknown): value is ItemStatus {
  return ITEM_STATUS_SET.has(value as ItemStatus);
}

/** 判断外部人工更新是否使用项目允许的状态意图。 */
export function is_item_manual_status(value: unknown): value is ItemManualStatus {
  return ITEM_MANUAL_STATUS_SET.has(value as ItemManualStatus);
}

// 文件格式只表示解析来源，不能用它替代文本规则语义
export function is_item_file_type(value: unknown): value is ItemFileType {
  return ITEM_FILE_TYPE_SET.has(value as ItemFileType);
}

// 文本规则语义用于过滤和保护规则，来源于格式处理器或兜底推断
export function is_item_text_type(value: unknown): value is ItemTextType {
  return Check(PROJECT_ITEM_PUBLIC_SCHEMA.properties.text_type, value);
}

// 完整公开 DTO 必须携带全部持久字段。缺失字段由迁移补齐。
export function collect_project_item_missing_public_fields(value: unknown): string[] {
  const record = read_json_record(value);
  const public_record: Record<string, unknown> = {
    ...record,
    item_id: record["item_id"] ?? record["id"],
    row_number: record["row_number"] ?? record["row"],
  };
  return PROJECT_ITEM_PUBLIC_SCHEMA.required!.filter((field) => public_record[field] === undefined);
}

// API 和项目 query 只使用 item_id/row_number，id/row 只在边界转换时短暂出现
export function normalize_project_item_public_record(
  value: unknown,
): ProjectItemPublicRecord | null {
  const record = read_json_record(value);
  if (collect_project_item_missing_public_fields(record).length > 0) {
    return null;
  }
  const item_id = read_json_integer(record["item_id"] ?? record["id"], 0);
  if (!Number.isInteger(item_id) || item_id <= 0) {
    return null;
  }
  const item = create_item({
    ...record,
    id: item_id,
    row: record["row"] ?? record["row_number"],
  });
  const public_record = build_project_item_public_record(item);
  return PROJECT_ITEM_PUBLIC_VALIDATOR.Check(public_record) ? public_record : null;
}

// 全量写库入口统一把公开 DTO 转回持久字段，避免页面层手写 id/row 映射
/**
 * 按公开 item 主键稳定排序并转换成数据库字段。
 */
export function build_project_item_persistent_records(
  items: Record<string, ProjectItemPublicRecord>,
): ProjectItemPersistentRecord[] {
  return Object.values(items)
    .sort((left, right) => left.item_id - right.item_id)
    .map(build_project_item_persistent_record);
}

/**
 * 已通过公开 DTO 边界的单条 item 只负责字段名转换。
 */
function build_project_item_persistent_record(
  public_record: ProjectItemPublicRecord,
): ProjectItemPersistentRecord {
  const { item_id, row_number, ...fields } = public_record;
  return {
    ...fields,
    name_src: structuredClone(fields.name_src),
    name_dst: structuredClone(fields.name_dst),
    id: item_id,
    row: row_number,
  };
}

// Ren'Py 控制标签内不含日韩文本时才视为语法标签，避免误判正文括号
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
