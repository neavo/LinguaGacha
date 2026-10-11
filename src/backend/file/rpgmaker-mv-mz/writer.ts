import type { Item } from "../../../domain/item";
import { read_json_record, type JsonValue } from "../../../domain/json";
import { read_item_name_text, resolve_output_item_name } from "../../../shared/item-name";
import type { FileFormatServiceConfig } from "../file-format-shared";
import { decode_javascript_string, encode_javascript_string } from "./javascript";
import { RPGMakerJsonCodec } from "./json-codec";
import {
  RPGMAKER_EVENT,
  type RPGMakerLocation,
  type RPGMakerRootLocation,
  type JsonPath,
} from "./types";

type Block = Extract<RPGMakerRootLocation, { kind: "block" }>;
type Replacement = { location: RPGMakerRootLocation; value: string };
type Change = {
  location: RPGMakerLocation;
  value?: string;
  children: Map<string, Change>;
};
const BLOCK_CONTINUATIONS = new Map<number, number>([
  [RPGMAKER_EVENT.MESSAGE_LINE, RPGMAKER_EVENT.MESSAGE_LINE],
  [RPGMAKER_EVENT.SCROLLING_LINE, RPGMAKER_EVENT.SCROLLING_LINE],
  [RPGMAKER_EVENT.COMMENT, RPGMAKER_EVENT.COMMENT_LINE],
  [RPGMAKER_EVENT.SCRIPT, RPGMAKER_EVENT.SCRIPT_LINE],
]);

/** 所有范围先在原稿上验证，字段先写入，事件块最后按原始索引倒序替换。 */
export function write_rpgmaker_items(
  root: JsonValue,
  items: readonly Item[],
  config: FileFormatServiceConfig,
  codec = new RPGMakerJsonCodec(),
): JsonValue {
  const replacements: Replacement[] = [];
  const roots = new Map<string, Change>();
  // 容器身份只取实际坐标，附加的镜像与姓名路径不产生另一份容器。
  function locate(location: RPGMakerLocation): Change {
    const nested = location.kind === "script" || location.kind === "json";
    const group = nested ? locate(location.container).children : roots;
    const key = JSON.stringify(
      location.kind === "script"
        ? [location.kind, location.start, location.end]
        : location.kind === "block"
          ? [location.kind, location.path, location.start, location.end]
          : [location.kind, location.path],
    );
    let change = group.get(key);
    if (!change) {
      change = { location, children: new Map() };
      group.set(key, change);
    } else if (
      (location.kind === "script" &&
        change.location.kind === "script" &&
        location.template !== change.location.template) ||
      (location.kind === "block" &&
        change.location.kind === "block" &&
        location.code !== change.location.code)
    )
      throw new Error("Conflicting RPG Maker container");
    return change;
  }
  /** 同一坐标只接收一份译文，防止条目顺序决定最终结果。 */
  function replace(location: RPGMakerLocation, value: string): void {
    const change = locate(location);
    if (change.value !== undefined) throw new Error("Duplicate RPG Maker location");
    change.value = value;
  }
  for (const item of items) {
    const location = read_json_record(read_json_record(item.extra_field)["rpgmaker"])[
      "location"
    ] as unknown as RPGMakerLocation;
    replace(location, item.dst);
    if (location.kind === "block" && location.name_path) {
      const name = resolve_output_item_name({
        ...item,
        write_translated_name_fields_to_file: config.write_translated_name_fields_to_file ?? true,
      });
      if (name !== null)
        replace({ kind: "field", path: location.name_path }, read_item_name_text(name));
    }
  }
  for (const change of roots.values()) {
    const location = change.location;
    if (location.kind !== "field" && location.kind !== "block")
      throw new Error("Invalid RPG Maker location kind");
    const value = rebuild_string(read_container(root, location), change, codec);
    replacements.push({ location, value });
    if (location.kind === "field") {
      for (const mirror of location.mirrors ?? [])
        replacements.push({ location: { kind: "field", path: mirror }, value });
    }
  }
  const fields = new Set<string>();
  const blocks = new Map<string, { location: Block; value: string; indent: number }[]>();
  for (const { location, value } of replacements) {
    if (location.kind === "field") {
      read_container(root, location);
      const key = JSON.stringify(location.path);
      if (fields.has(key)) throw new Error("Duplicate RPG Maker field");
      fields.add(key);
    } else if (location.kind === "block") {
      const key = JSON.stringify(location.path);
      const group = blocks.get(key) ?? [];
      group.push({ location, value, indent: read_block(root, location).indent });
      blocks.set(key, group);
    } else throw new Error("Invalid RPG Maker location kind");
  }
  for (const group of blocks.values()) {
    let boundary = Infinity;
    for (const { location } of group.sort(
      (a, b) => b.location.start - a.location.start || b.location.end - a.location.end,
    )) {
      if (location.end > boundary) throw new Error("Overlapping RPG Maker blocks");
      boundary = location.start;
      for (const other of replacements) {
        const target = other.location.path;
        if (
          target.length > location.path.length &&
          location.path.every((key, index) => target[index] === key)
        ) {
          const index = target[location.path.length];
          if (typeof index === "number" && index >= location.start && index < location.end)
            throw new Error("Overlapping RPG Maker locations");
        }
      }
    }
  }
  for (const { location, value } of replacements) {
    if (location.kind !== "field") continue;
    if (location.path.length === 0) root = value;
    else write_json_path(root, location.path, value);
  }
  for (const group of blocks.values()) {
    for (const { location, value, indent } of group) {
      const list = read_json_path(root, location.path);
      if (!Array.isArray(list)) throw new Error("Invalid event list");
      const lines = value.split(/\r\n|\r|\n/u).map((line, index) => ({
        code: index === 0 ? location.code : BLOCK_CONTINUATIONS.get(location.code)!,
        indent,
        parameters: [line],
      }));
      list.splice(location.start, location.end - location.start, ...lines);
    }
  }
  return root;
}

/** 每层先合并内部修改，再编码一次；没有值变化的容器保留原始空白和转义。 */
function rebuild_string(source: string, change: Change, codec: RPGMakerJsonCodec): string {
  if (change.value !== undefined) {
    if (change.children.size > 0) throw new Error("Overlapping RPG Maker container replacements");
    return change.value;
  }
  const children = [...change.children.values()];
  const kind = children[0]?.location.kind;
  if (kind === "json") {
    const root = codec.parse(source);
    if (root === null || typeof root !== "object") throw new Error("Invalid JSON string container");
    let changed = false;
    for (const child of children) {
      if (child.location.kind !== "json") throw new Error("Conflicting RPG Maker container kinds");
      const target = child.location.path;
      const original = read_json_path(root, target);
      if (typeof original !== "string") throw new Error("Invalid JSON string field");
      const value = rebuild_string(original, child, codec);
      if (value !== original) {
        write_json_path(root, target, value);
        changed = true;
      }
    }
    return changed ? codec.stringify(root) : source;
  }
  if (kind !== "script") throw new Error("Invalid RPG Maker container kind");
  const spans = children.map((child) => {
    const location = child.location;
    if (location.kind !== "script") throw new Error("Conflicting RPG Maker container kinds");
    validate_range(location.start, location.end, source.length);
    if (typeof location.template !== "boolean" || location.start === location.end)
      throw new Error("Invalid JavaScript literal location");
    const literal = source.slice(location.start, location.end);
    const original = decode_javascript_string(literal, location.template);
    const value = rebuild_string(original, child, codec);
    return {
      start: location.start,
      end: location.end,
      value: value === original ? literal : encode_javascript_string(value, location.template),
    };
  });
  let text = source;
  let boundary = source.length;
  for (const span of spans.sort((a, b) => b.start - a.start)) {
    if (span.end > boundary) throw new Error("Overlapping JavaScript spans");
    text = text.slice(0, span.start) + span.value + text.slice(span.end);
    boundary = span.start;
  }
  return text;
}

/** 持久偏移必须是原稿内的整数半开范围，空事件块允许插入。 */
function validate_range(start: number, end: number, length: number): void {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start > end ||
    end > length
  )
    throw new Error("Invalid RPG Maker range");
}

/** 脚本文本按保存的字段或事件块还原，偏移始终相对该容器。 */
function read_container(root: JsonValue, container: RPGMakerRootLocation): string {
  if (container.kind === "block") return read_block(root, container).text;
  if (container.kind !== "field") throw new Error("Invalid RPG Maker location kind");
  const value = read_json_path(root, container.path);
  if (typeof value !== "string") throw new Error("Invalid RPG Maker field");
  return value;
}

/** 检查头指令、续行和缩进，防止范围截断或吞掉相邻指令。 */
function read_block(root: JsonValue, location: Block): { text: string; indent: number } {
  const list = read_json_path(root, location.path);
  if (!Array.isArray(list)) throw new Error("Invalid event list");
  validate_range(location.start, location.end, list.length);
  const continuation = BLOCK_CONTINUATIONS.get(location.code);
  if (continuation === undefined) throw new Error("Invalid event block code");
  const has_header =
    location.code === RPGMAKER_EVENT.MESSAGE_LINE ||
    location.code === RPGMAKER_EVENT.SCROLLING_LINE;
  const first = read_json_record(list[has_header ? location.start - 1 : location.start]);
  const header_code =
    location.code === RPGMAKER_EVENT.MESSAGE_LINE
      ? RPGMAKER_EVENT.MESSAGE
      : location.code === RPGMAKER_EVENT.SCROLLING_LINE
        ? RPGMAKER_EVENT.SCROLLING
        : location.code;
  const indent = first["indent"];
  if (
    first["code"] !== header_code ||
    typeof indent !== "number" ||
    !Number.isSafeInteger(indent) ||
    indent < 0 ||
    !Array.isArray(first["parameters"])
  )
    throw new Error("Invalid event block header");
  const lines = list.slice(location.start, location.end).map((value, index) => {
    const command = read_json_record(value);
    const parameters = command["parameters"];
    if (
      command["code"] !== (index === 0 ? location.code : continuation) ||
      command["indent"] !== indent ||
      !Array.isArray(parameters) ||
      typeof parameters[0] !== "string"
    )
      throw new Error("Invalid event block line");
    return parameters[0];
  });
  if (!has_header && lines.length === 0) throw new Error("Empty event block");
  const next = read_json_record(list[location.end]);
  if (next["code"] === continuation && next["indent"] === indent)
    throw new Error("Incomplete event block");
  return { text: lines.join("\n"), indent };
}

/** 持久路径只允许访问原稿已有的自有字段与数组索引。 */
function read_json_path(root: JsonValue, target: JsonPath): JsonValue {
  if (!Array.isArray(target)) throw new Error("Invalid RPG Maker path");
  let value = root;
  for (const key of target) {
    if (
      value === null ||
      typeof value !== "object" ||
      (Array.isArray(value)
        ? typeof key !== "number" || !Number.isSafeInteger(key) || key < 0
        : typeof key !== "string") ||
      !Object.hasOwn(value, key)
    )
      throw new Error("Invalid RPG Maker path");
    value = (value as Record<string | number, JsonValue>)[key]!;
  }
  return value;
}

/** 所有定位已在原稿上校验，字段替换仅覆盖现有字符串。 */
function write_json_path(root: JsonValue, target: JsonPath, value: JsonValue): void {
  const parent = read_json_path(root, target.slice(0, -1));
  (parent as Record<string | number, JsonValue>)[target.at(-1)!] = value;
}
