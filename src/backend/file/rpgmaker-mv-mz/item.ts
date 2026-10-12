import type { Item, ItemStatus } from "../../../domain/item";
import { read_json_record } from "../../../domain/json";
import type { RPGMakerMetadata } from "./types";
import { validate_zip_member_path } from "../zip-members";

/** 共享读取验证来源与定位种类，精确坐标由写回器对照原稿验证。 */
export function read_rpgmaker_metadata(
  extra_field: Item["extra_field"],
): Omit<RPGMakerMetadata, "usage"> & { usage: string } {
  const value = read_json_record(read_json_record(extra_field)["rpgmaker_mv_mz"]);
  if (
    typeof value["internal_file_path"] !== "string" ||
    typeof value["usage"] !== "string" ||
    !["field", "block", "script", "json"].includes(
      String(read_json_record(value["location"])["kind"]),
    )
  )
    throw new Error("Invalid RPG Maker metadata");
  if (validate_zip_member_path(value["internal_file_path"]) !== value["internal_file_path"])
    throw new Error("Noncanonical RPG Maker internal path");
  return value as unknown as RPGMakerMetadata;
}

/** 提取与文件重置共用来源和用途默认状态，普通编辑和失败重试尊重当前翻译资格。 */
export function rpgmaker_default_status(item: Pick<Item, "extra_field">): ItemStatus {
  const { usage, location } = read_rpgmaker_metadata(item.extra_field);
  // JSON 叶子继承外层代码来源，展开字符串不能改变默认翻译资格。
  let container = location;
  while (container.kind === "json") container = container.container;
  if (container.kind === "script") return "RULE_SKIPPED";
  return usage === "text" ? "NONE" : "RULE_SKIPPED";
}
