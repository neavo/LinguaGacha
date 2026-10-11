import path from "node:path";
import type { Item, ItemStatus } from "../../../domain/item";
import { read_json_record } from "../../../domain/json";
import type { RPGMakerMetadata } from "./types";
import { AppError } from "../../../shared/error";

/** 内部路径跨平台保存，拒绝越界和 Windows 路径别名。 */
export function validate_rpgmaker_path(value: string): string {
  const normalized = value.replace(/\\/gu, "/");
  if (
    !normalized ||
    normalized
      .split("/")
      .some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          /[:<>"|?*\p{Cc}]/u.test(part) ||
          /[. ]$/u.test(part) ||
          /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part),
      )
  )
    throw new AppError("file.invalid_structure", { public_details: { file: value } });
  return normalized;
}

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
  if (validate_rpgmaker_path(value["internal_file_path"]) !== value["internal_file_path"])
    throw new Error("Noncanonical RPG Maker internal path");
  return value as unknown as RPGMakerMetadata;
}

/** 提取与文件重置共用来源和用途默认状态，普通编辑和失败重试尊重当前翻译资格。 */
export function rpgmaker_default_status(item: Pick<Item, "extra_field">): ItemStatus {
  // 原生 RM 来源发现只收集插件 JavaScript，扩大来源范围时须同步调整此规则。
  const { internal_file_path, usage } = read_rpgmaker_metadata(item.extra_field);
  if (path.extname(internal_file_path).toLowerCase() === ".js") return "RULE_SKIPPED";
  return usage === "text" ? "NONE" : "RULE_SKIPPED";
}
