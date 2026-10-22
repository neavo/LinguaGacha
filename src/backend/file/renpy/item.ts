import assert from "node:assert/strict";
import type { Item, ItemStatus } from "../../../domain/item";
import { read_json_record } from "../../../domain/json";
import { validate_game_path } from "../source-file-paths";
import type { RenpyUsage } from "./usage";

export type RenpyMetadata = {
  internal_file_path: string;
  digest: string;
  usage: RenpyUsage | "common";
  key: string;
};
/** 在持久化边界收窄条目身份，实际原文与目标由导出入口校验。 */
export function read_renpy_metadata(extra: Item["extra_field"]): RenpyMetadata {
  const value = read_json_record(read_json_record(extra)["renpy"]);
  assert(typeof value["internal_file_path"] === "string", "Invalid Ren'Py member");
  validate_game_path(value["internal_file_path"]);
  assert(
    typeof value["digest"] === "string" && /^[a-f0-9]{64}$/u.test(value["digest"]),
    "Invalid Ren'Py digest",
  );
  assert(
    typeof value["key"] === "string" &&
      typeof value["usage"] === "string" &&
      ["say", "menu", "display", "paragraph", "code", "string", "common"].includes(value["usage"]),
    "Invalid Ren'Py candidate",
  );
  return value as unknown as RenpyMetadata;
}
/** 默认用途只作用于导入和重置，人工放行由条目状态决定。 */
export function renpy_default_status(item: Pick<Item, "extra_field">): ItemStatus {
  return read_renpy_metadata(item.extra_field).usage === "code" ? "RULE_SKIPPED" : "NONE";
}
