import assert from "node:assert/strict";
import type { Item, ItemStatus } from "../../../domain/item";
import { read_json_record } from "../../../domain/json";
import { validate_game_path } from "../source-file-paths";

/** 只有 `text` 默认翻译。姓名可能是角色或语音查找键，参数与代码可能是程序引用。 */
const TYRANO_USAGES = ["text", "name", "parameter", "code"] as const;
export type TyranoUsage = (typeof TYRANO_USAGES)[number];
const LOCATION_KINDS = ["text", "param", "name", "script", "config"] as const; // 正文、标签参数、`#` 姓名、JavaScript 字符串与配置值。
/** 坐标为去除 BOM 后原稿文本中的 UTF-16 半开范围。 */
export type TyranoLocation = Readonly<{
  kind: (typeof LOCATION_KINDS)[number];
  start: number;
  end: number;
  template?: boolean; // 仅 `script`：模板字符串片段使用模板转义。
}>;
/** 条目随工程持久化的格式私有字段。 */
export type TyranoMetadata = Readonly<{
  internal_file_path: string;
  usage: TyranoUsage;
  location: TyranoLocation;
  line: number; // 原稿中从 1 开始的行号，供审校定位。
  source_context?: string; // 参数所在标签或字符串所在语句，供审校查看原稿语境。
}>;

/** 持久化边界只检查形状，写回时再对照固化原稿验证范围与原文。 */
export function read_tyrano_metadata(extra: Item["extra_field"]): TyranoMetadata {
  const value = read_json_record(read_json_record(extra)["tyrano"]);
  assert(typeof value["internal_file_path"] === "string", "Invalid Tyrano member");
  validate_game_path(value["internal_file_path"]);
  assert(TYRANO_USAGES.includes(value["usage"] as TyranoUsage), "Invalid Tyrano usage");
  const location = read_json_record(value["location"]);
  assert(
    LOCATION_KINDS.includes(location["kind"] as TyranoLocation["kind"]) &&
      Number.isSafeInteger(location["start"]) &&
      Number.isSafeInteger(location["end"]) &&
      Number(location["start"]) >= 0 &&
      Number(location["end"]) >= Number(location["start"]),
    "Invalid Tyrano location",
  );
  return value as unknown as TyranoMetadata;
}

/** 导入与重置共用的默认状态，人工放行后仍可写回。 */
export function tyrano_default_status(item: Pick<Item, "extra_field">): ItemStatus {
  return read_tyrano_metadata(item.extra_field).usage === "text" ? "NONE" : "RULE_SKIPPED";
}
