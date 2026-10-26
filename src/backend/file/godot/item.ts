import assert from "node:assert/strict";
import type { Item, ItemStatus } from "../../../domain/item";
import { read_json_record } from "../../../domain/json";
import { validate_game_path } from "../source-file-paths";

/** 坐标绑定固化原稿，代码用途只决定默认状态，人工放行仍可写回。 */
export type GodotLocation =
  | { kind: "gdsc"; token: number }
  | { kind: "gd" | "po"; start: number; end: number }
  | { kind: "scene"; node: number; property: string }
  | { kind: "scene_value"; node: number; property: string; offset: number }
  | { kind: "resource"; offset: number }
  | { kind: "slot"; word: number };
export type GodotMetadata = {
  internal_file_path: string;
  usage: "text" | "code";
  location: GodotLocation;
};
const LOCATION_FIELDS = {
  gdsc: ["token"],
  gd: ["start", "end"],
  po: ["start", "end"],
  scene: ["node", "property"],
  scene_value: ["node", "property", "offset"],
  resource: ["offset"],
  slot: ["word"],
} as const;

/** 持久化元数据先检查形状，写回时再对照原稿验证实际目标与原文。 */
export function read_godot_metadata(extra: Item["extra_field"]): GodotMetadata {
  const value = read_json_record(read_json_record(extra)["godot"]);
  assert(typeof value["internal_file_path"] === "string", "Invalid Godot internal path");
  validate_game_path(value["internal_file_path"]);
  assert(value["usage"] === "text" || value["usage"] === "code", "Invalid Godot usage");
  const location = read_json_record(value["location"]),
    kind = location["kind"];
  assert(
    typeof kind === "string" && Object.hasOwn(LOCATION_FIELDS, kind),
    "Invalid Godot location",
  );
  const fields = LOCATION_FIELDS[kind as keyof typeof LOCATION_FIELDS];
  assert(Object.keys(location).length === fields.length + 1, "Invalid Godot location fields");
  for (const field of fields) {
    const coordinate = location[field];
    if (field === "property")
      assert(typeof coordinate === "string" && coordinate.length > 0, "Invalid Godot property");
    else
      assert(
        Number.isSafeInteger(coordinate) && Number(coordinate) >= 0,
        "Invalid Godot coordinate: " + field,
      );
  }
  if (kind === "gd" || kind === "po")
    assert(Number(location["end"]) > Number(location["start"]), "Invalid Godot span");
  return value as unknown as GodotMetadata;
}

/** 重置条目时恢复导入用途决定的默认状态。 */
export function godot_default_status(item: Pick<Item, "extra_field">): ItemStatus {
  return read_godot_metadata(item.extra_field).usage === "text" ? "NONE" : "RULE_SKIPPED";
}
