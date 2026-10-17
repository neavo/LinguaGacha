import assert from "node:assert/strict";
import type { WolfDocument } from "./binary";
import { create_item, type Item, type ItemStatus } from "../../../domain/item";
import { read_json_record } from "../../../domain/json";
import { validate_game_path } from "../source-file-paths";

/** 全部坐标是固化原稿中的零基物理索引，事件 ID 只用于显示。 */
export type WolfLocation =
  | Readonly<{ kind: "game_string"; string: number }>
  | Readonly<{ kind: "common_name"; event: number }>
  | Readonly<{
      kind: "common_command";
      event: number;
      command: number;
      code: number;
      string: number;
    }>
  | Readonly<{ kind: "map_name"; event: number }>
  | Readonly<{ kind: "map_graphic"; event: number; page: number }>
  | Readonly<{
      kind: "map_command";
      event: number;
      page: number;
      command: number;
      code: number;
      string: number;
    }>
  | Readonly<{ kind: "database_string"; type: number; record: number; string: number }>
  | Readonly<{ kind: "database_type"; type: number }>
  | Readonly<{ kind: "database_record"; type: number; record: number }>
  | Readonly<{ kind: "database_field"; type: number; field: number }>
  | Readonly<{ kind: "tileset_string"; record: number; string: number }>;
export type WolfMetadata = Readonly<{
  internal_file_path: string;
  usage: "text" | "metadata";
  location: WolfLocation;
}>;
const LOCATION_FIELDS = {
  game_string: ["string"],
  common_name: ["event"],
  common_command: ["event", "command", "code", "string"],
  map_name: ["event"],
  map_graphic: ["event", "page"],
  map_command: ["event", "page", "command", "code", "string"],
  database_string: ["type", "record", "string"],
  database_type: ["type"],
  database_record: ["type", "record"],
  database_field: ["type", "field"],
  tileset_string: ["record", "string"],
} as const;

/** 持久化输入按种类和完整字段集合验证，不接受行号或字节偏移定位。 */
export function read_wolf_metadata(extra: Item["extra_field"]): WolfMetadata {
  const value = read_json_record(read_json_record(extra)["wolf3"]);
  assert(typeof value["internal_file_path"] === "string", "Invalid WOLF internal path");
  validate_game_path(value["internal_file_path"]);
  assert(value["usage"] === "text" || value["usage"] === "metadata", "Invalid WOLF usage");
  const location = read_json_record(value["location"]),
    kind = location["kind"];
  assert(
    typeof kind === "string" && Object.hasOwn(LOCATION_FIELDS, kind),
    "Invalid WOLF location kind",
  );
  const fields = LOCATION_FIELDS[kind as keyof typeof LOCATION_FIELDS];
  assert(Object.keys(location).length === fields.length + 1, "Invalid WOLF location fields");
  for (const field of fields)
    assert(
      Number.isSafeInteger(location[field]) && Number(location[field]) >= 0,
      "Invalid WOLF physical index: " + field,
    );
  return value as unknown as WolfMetadata;
}

/** 导入和重置共用资格，人工放行后的写回由原稿槽位验证。 */
export function wolf_default_status(item: Pick<Item, "extra_field">): ItemStatus {
  return read_wolf_metadata(item.extra_field).usage === "text" ? "NONE" : "RULE_SKIPPED";
}

/** 生成稳定键时显式排列字段，JSON 属性顺序不参与持久定位。 */
export function wolf_location_key(location: WolfLocation): string {
  const fields = LOCATION_FIELDS[location.kind];
  return [
    location.kind,
    ...fields.map((field) => (location as unknown as Record<string, number>)[field]),
  ].join(":");
}

/** 直接使用文件上下文给出的最终用途，保留每个条目的结构定位。 */
export function extract_wolf_items(document: WolfDocument, file: string): Item[] {
  return document.slots
    .filter((slot) => slot.text !== "")
    .map((slot, row) => {
      const usage = slot.usage;
      return create_item({
        file_type: "WOLF3",
        file_path: file,
        row,
        src: slot.text,
        status: usage === "text" ? "NONE" : "RULE_SKIPPED",
        extra_field: { wolf3: { internal_file_path: file, usage, location: slot.location } },
      });
    });
}
