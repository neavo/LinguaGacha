import assert from "node:assert/strict";
import type { Item, ItemStatus } from "../../../domain/item";
import { read_json_record } from "../../../domain/json";
import { validate_zip_member_path } from "../zip-members";
import type { RubyPath } from "./value";
import type { RubyLocation } from "./ruby";

export type RGSSContainer =
  | { kind: "field"; path: RubyPath; mirrors?: RubyPath[] }
  | { kind: "block"; path: RubyPath; start: number; end: number; code: number }
  | { kind: "archive"; path: RubyPath };
export type RGSSLocation =
  | RGSSContainer
  | { kind: "ruby"; container: RGSSContainer; span: RubyLocation };
export type RGSSMetadata = {
  internal_file_path: string;
  usage: "text" | "metadata";
  location: RGSSLocation;
};
/** 只接受数组索引、对象成员或 Hash 项，防止含糊路径进入写回。 */
function validate_path(value: unknown): void {
  assert(Array.isArray(value), "Invalid RGSS path");
  for (const part of value) {
    if (typeof part === "number") {
      assert(Number.isSafeInteger(part) && part >= 0, "Invalid RGSS index");
    } else {
      const member = read_json_record(part);
      assert(
        Object.keys(member).length === 1 &&
          (typeof member["field"] === "string" ||
            (Number.isSafeInteger(member["entry"]) && Number(member["entry"]) >= 0)),
        "Invalid RGSS member",
      );
    }
  }
}
/** 字段与事件块各自校验坐标，实际存在性由原稿槽位解析确认。 */
function validate_container(value: unknown): void {
  const container = read_json_record(value);
  validate_path(container["path"]);
  switch (container["kind"]) {
    case "field":
      if (container["mirrors"] !== undefined) {
        assert(Array.isArray(container["mirrors"]), "Invalid RGSS mirrors");
        for (const path of container["mirrors"]) validate_path(path);
      }
      break;
    case "archive":
      break;
    case "block":
      assert(
        Number.isSafeInteger(container["start"]) &&
          Number(container["start"]) >= 0 &&
          Number.isSafeInteger(container["end"]) &&
          Number(container["end"]) > Number(container["start"]) &&
          Number.isSafeInteger(container["code"]),
        "Invalid RGSS block",
      );
      break;
    default:
      throw new Error("Invalid RGSS container");
  }
}
/** 持久定位在消费边界收窄，Ruby 的派生语法信息由原稿提供。 */
export function read_rgss_metadata(extra: Item["extra_field"]): RGSSMetadata {
  const value = read_json_record(read_json_record(extra)["rpgmaker_rgss"]);
  if (
    typeof value["internal_file_path"] !== "string" ||
    typeof value["usage"] !== "string" ||
    !["field", "block", "archive", "ruby"].includes(
      String(read_json_record(value["location"])["kind"]),
    )
  )
    throw new Error("Invalid RGSS metadata");
  if (validate_zip_member_path(value["internal_file_path"]) !== value["internal_file_path"])
    throw new Error("Noncanonical RGSS path");
  const location = read_json_record(value["location"]);
  if (location["kind"] === "ruby") {
    validate_container(location["container"]);
    const span = read_json_record(location["span"]);
    assert(
      Object.keys(span).length === 2 &&
        Number.isSafeInteger(span["start"]) &&
        Number(span["start"]) >= 0 &&
        Number.isSafeInteger(span["end"]) &&
        Number(span["end"]) >= Number(span["start"]),
      "Invalid Ruby byte range",
    );
  } else validate_container(location);
  return value as unknown as RGSSMetadata;
}
/** 重置沿用原稿提取用途，保留资源和接口字段的默认排除。 */
export function rgss_default_status(item: Pick<Item, "extra_field">): ItemStatus {
  return read_rgss_metadata(item.extra_field).usage === "text" ? "NONE" : "RULE_SKIPPED";
}
