import type { Item } from "../../../domain/item";
import { read_json_record, type JsonValue } from "../../../domain/json";
import { read_item_name_text, resolve_output_item_name } from "../../../shared/item-name";
import type { FileFormatServiceConfig } from "../file-format-shared";
import { encode_javascript_string } from "./javascript";
import { RPGMAKER_EVENT, type RPGMakerLocation, type JsonPath } from "./types";

type Container = Exclude<RPGMakerLocation, { kind: "script" }>;
type Block = Extract<Container, { kind: "block" }>;
type Replacement = { location: Container; value: string };
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
): JsonValue {
  const replacements: Replacement[] = [];
  const scripts = new Map<
    string,
    {
      container: Container;
      source: string;
      spans: { start: number; end: number; value: string }[];
    }
  >();
  for (const item of items) {
    const location = read_json_record(read_json_record(item.extra_field)["rpgmaker"])[
      "location"
    ] as unknown as RPGMakerLocation;
    if (location.kind === "script") {
      const container = location.container;
      const key = JSON.stringify([
        container.kind,
        container.path,
        container.kind === "block" ? [container.start, container.end, container.code] : null,
      ]);
      const group = scripts.get(key) ?? {
        container,
        source: read_container(root, container),
        spans: [],
      };
      validate_range(location.start, location.end, group.source.length);
      if (typeof location.template !== "boolean" || location.start === location.end)
        throw new Error("Invalid JavaScript literal location");
      if (!location.template) {
        const quote = group.source[location.start];
        if ((quote !== '"' && quote !== "'") || group.source[location.end - 1] !== quote)
          throw new Error("Invalid JavaScript string delimiters");
      }
      group.spans.push({
        start: location.start,
        end: location.end,
        value: encode_javascript_string(item.dst, location.template),
      });
      scripts.set(key, group);
    } else {
      replacements.push({ location, value: item.dst });
      if (location.kind === "field") {
        for (const mirror of location.mirrors ?? [])
          replacements.push({ location: { kind: "field", path: mirror }, value: item.dst });
      } else if (location.name_path) {
        const name = resolve_output_item_name({
          ...item,
          write_translated_name_fields_to_file: config.write_translated_name_fields_to_file ?? true,
        });
        if (name !== null)
          replacements.push({
            location: { kind: "field", path: location.name_path },
            value: read_item_name_text(name),
          });
      }
    }
  }
  for (const { container, source, spans } of scripts.values()) {
    let text = source;
    let boundary = text.length;
    for (const span of spans.sort((a, b) => b.start - a.start)) {
      if (span.end > boundary) throw new Error("Overlapping JavaScript spans");
      text = text.slice(0, span.start) + span.value + text.slice(span.end);
      boundary = span.start;
    }
    replacements.push({ location: container, value: text });
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
    const ranges = new Set<string>();
    for (const { location } of group.sort(
      (a, b) => b.location.start - a.location.start || b.location.end - a.location.end,
    )) {
      const range = JSON.stringify([location.start, location.end]);
      if (location.end > boundary || ranges.has(range))
        throw new Error("Overlapping RPG Maker blocks");
      ranges.add(range);
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
function read_container(root: JsonValue, container: Container): string {
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
