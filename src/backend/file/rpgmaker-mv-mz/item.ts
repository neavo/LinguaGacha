import path from "node:path";
import type { Item, ItemStatus } from "../../../domain/item";
import { read_json_record } from "../../../domain/json";

/** 提取与文件重置共用来源和用途默认状态，普通编辑和失败重试尊重当前翻译资格。 */
export function rpgmaker_default_status(item: Pick<Item, "file_path" | "extra_field">): ItemStatus {
  // 原生 RM 来源发现只收集插件 JavaScript，扩大来源范围时须同步调整此规则。
  if (path.extname(item.file_path).toLowerCase() === ".js") return "RULE_SKIPPED";
  const usage = read_json_record(read_json_record(item.extra_field)["rpgmaker"])["usage"];
  return usage === "text" ? "NONE" : "RULE_SKIPPED";
}
