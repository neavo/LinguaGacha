import type { Item, ItemStatus } from "../../../domain/item";
import { read_json_record } from "../../../domain/json";

/** 提取与文件重置共用用途默认状态，普通编辑和失败重试尊重当前翻译资格。 */
export function rpgmaker_default_status(extra_field: Item["extra_field"]): ItemStatus {
  const usage = read_json_record(read_json_record(extra_field)["rpgmaker"])["usage"];
  return usage === "display" || usage === "script" ? "NONE" : "RULE_SKIPPED";
}
