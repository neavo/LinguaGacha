import { RPGMAKER_EVENT as EVENT } from "../shared/rpgmaker-event";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { create_item, type Item } from "../../../domain/item";
import type { JsonValue } from "../../../domain/json";
import type { SourceFileParseWarning } from "../file-format-types";
import { base, field, symbol, decode, encode, type MarshalNode } from "./marshal";
import {
  array,
  integer,
  bytes,
  text,
  write_text,
  replace_bytes,
  replace_text,
  RubySlots,
  read_slot,
  write_slot,
  type RubySlot,
  type RubyPath,
} from "./value";
import { read_ruby_strings, write_ruby_strings } from "./ruby";
import {
  read_rgss_metadata,
  rgss_default_status,
  type RGSSLocation,
  type RGSSContainer,
} from "./item";
import type { RGSSVersion } from "./source";
import { read_rgss_script } from "./scripts";

const DEFAULT_TEXT_FIELDS: Record<string, readonly string[]> = {
  Actors: ["@name", "@nickname", "@description"],
  Classes: ["@name"],
  Skills: ["@name", "@description", "@message1", "@message2"],
  Items: ["@name", "@description"],
  Weapons: ["@name", "@description"],
  Armors: ["@name", "@description"],
  Enemies: ["@name"],
  States: ["@name", "@message1", "@message2", "@message3", "@message4"],
}; // 引擎标准字段默认参与翻译，是否被脚本按名称引用由领域审校判断。
// `@game_title` 可能被脚本用作窗口标识并转为 Shift_JIS，默认按元数据保留原文。
const SYSTEM_DEFAULT_TEXT_FIELDS = new Set([
  "@currency_unit",
  "@elements",
  "@skill_types",
  "@weapon_types",
  "@armor_types",
  "@terms",
  "@words",
]);
const BLOCKS = new Map<number, number>([
  [EVENT.MESSAGE, EVENT.MESSAGE_LINE],
  [EVENT.SCROLLING, EVENT.SCROLLING_LINE],
  [EVENT.COMMENT, EVENT.COMMENT_LINE],
  [EVENT.SCRIPT, EVENT.SCRIPT_LINE],
]);
const ACTOR_TEXT_CODES = new Set<number>([
  EVENT.ACTOR_NAME,
  EVENT.ACTOR_NICKNAME,
  EVENT.ACTOR_PROFILE,
]);
const MESSAGE_LINES = 4;
const DATABASE_FILE_PATTERN = /^data\/([^/]+)\.[^./]+$/iu; // 标准数据库只位于数据目录的直接成员。
const member = (name: string) => ({ field: name }); // 字段段与数组索引、Hash 项使用不同形状。
const COMMAND_CLASSES = { event: "RPG::EventCommand", move: "RPG::MoveCommand" } as const;
/** 类型身份决定是否进入事件解释，普通数据中的同名字段不代表指令。 */
function command_kind(node: MarshalNode): "event" | "move" | null {
  const value = base(node);
  if (value.t !== "o") return null;
  const name = symbol(value.klass!);
  return name === COMMAND_CLASSES.event ? "event" : name === COMMAND_CLASSES.move ? "move" : null;
}
/** 确认指令类型后读取参数，移动指令缺少缩进时使用根层级。 */
function command(node: MarshalNode) {
  const kind = command_kind(node);
  assert(kind !== null, "Expected RPG Maker command");
  const code = field(node, "@code"),
    parameters = field(node, "@parameters");
  assert(code && parameters, "Invalid RGSS command");
  return {
    kind,
    code: integer(code),
    indent: field(node, "@indent") ? integer(field(node, "@indent")!) : 0,
    parameters: array(parameters),
  };
}
/** 保存的位置始终对照固化原稿读取，事件续行须属于同一指令块。 */
function read_container(slots: RubySlots, location: RGSSContainer, version: RGSSVersion): string {
  if (location.kind === "field") return text(slots.read(location.path));
  if (location.kind === "archive") return read_rgss_script(slots.read(location.path)).source;
  const list = array(slots.read(location.path));
  assert(
    Number.isInteger(location.start) &&
      Number.isInteger(location.end) &&
      location.start >= 0 &&
      location.end > location.start &&
      location.end <= list.length,
    "Invalid RGSS block range",
  );
  const header = command(list[location.start]!);
  assert(
    header.kind === "event" && header.code === location.code && BLOCKS.has(header.code),
    "Invalid RGSS block header",
  );
  const first =
    (header.code === EVENT.MESSAGE && version !== "xp") || header.code === EVENT.SCROLLING
      ? location.start + 1
      : location.start;
  for (let index = location.start + 1; index < location.end; index++) {
    const next = command(list[index]!);
    assert(
      next.kind === "event" &&
        next.code === BLOCKS.get(header.code) &&
        next.indent === header.indent,
      "Invalid RGSS continuation",
    );
  }
  return list
    .slice(first, location.end)
    .map((node) => text(command(node).parameters[0]!))
    .join("\n");
}
type BlockTarget = { list: MarshalNode; start: number; end: number; code: number };
type WriteTarget = RubySlot | BlockTarget;
/** 字段归实际槽位，事件块归实际列表及原稿区间，路径只承担寻址。 */
class RGSSLocations {
  public readonly slots: RubySlots;
  private readonly blocks = new Map<MarshalNode, Map<number, BlockTarget>>();
  /** 单次读取或写回共用一个槽位注册表。 */
  public constructor(root: MarshalNode) {
    this.slots = new RubySlots(root);
  }
  /** 字段别名共用槽位，事件列表别名共用原始区间。 */
  public resolve(location: RGSSContainer): WriteTarget {
    if (location.kind !== "block") return this.slots.resolve(location.path);
    const list = base(this.slots.read(location.path));
    array(list);
    let blocks = this.blocks.get(list);
    if (!blocks) {
      blocks = new Map();
      this.blocks.set(list, blocks);
    }
    let target = blocks.get(location.start);
    if (target)
      assert(
        target.end === location.end && target.code === location.code,
        "Conflicting RGSS block location",
      );
    else {
      target = { list, start: location.start, end: location.end, code: location.code };
      blocks.set(location.start, target);
    }
    return target;
  }
}
/** 标准字段入口独立传播默认翻译资格，槽位集合不受原稿成员顺序影响。 */
function read_default_text_slots(root: MarshalNode, file: string, slots: RubySlots): Set<RubySlot> {
  const result = new Set<RubySlot>(),
    visited = new Set<MarshalNode>();
  // 标准字段只传播默认翻译资格，共享对象无需按每条路径重复展开。
  function visit(node: MarshalNode, target: RubyPath): void {
    const value = base(node);
    if (value.t === '"') {
      result.add(slots.resolve(target));
      return;
    }
    if (visited.has(value)) return;
    visited.add(value);
    if (value.t === "[") value.items!.forEach((entry, index) => visit(entry, [...target, index]));
    else if (value.t === "o" || value.t === "S")
      for (const [key, entry] of value.pairs!) visit(entry, [...target, member(symbol(key))]);
    else if (value.t === "{" || value.t === "}")
      value.pairs!.forEach(([, entry], index) => visit(entry, [...target, { entry: index }]));
  }
  // 从标准字段进入默认翻译区域，资源字段不因共享字符串而继承用途。
  function fields(node: MarshalNode, keys: Iterable<string>, target: RubyPath): void {
    for (const key of keys) {
      const entry = field(node, key);
      if (entry) visit(entry, [...target, member(key)]);
    }
  }
  const database_fields = DEFAULT_TEXT_FIELDS[file];
  if (database_fields && base(root).t === "[")
    array(root).forEach((record, index) => fields(record, database_fields, [index]));
  if (file === "System") fields(root, SYSTEM_DEFAULT_TEXT_FIELDS, []);
  else if (/^Map\d+$/u.test(file)) fields(root, ["@display_name"], []);
  return result;
}

/** 原生对象直接提供字段和事件定位，不经有损 JSON 中间层。 */
export async function read_rgss_data(
  root: MarshalNode,
  file: string,
  version: RGSSVersion,
  scripts: boolean,
) {
  const warnings: SourceFileParseWarning[] = [];
  type Candidate = { src: string; location: RGSSLocation; default_text: boolean };
  const candidates: Candidate[] = [];
  const name = DATABASE_FILE_PATTERN.exec(file)?.[1] ?? ""; // 子目录同名文件不触发数据库字段规则。
  const locations = new RGSSLocations(root);
  const default_text_slots = read_default_text_slots(root, name, locations.slots);
  const seen = new Map<WriteTarget, Map<string, Candidate>>();
  // 同一写入目标合并用途与关联位置，首次路径保持稳定。
  function add(src: string, location: RGSSLocation, default_text: boolean) {
    if (!src) return;
    const container = location.kind === "ruby" ? location.container : location;
    const target = locations.resolve(container);
    const key = location.kind === "ruby" ? `${location.span.start}:${location.span.end}` : "";
    const entries = seen.get(target) ?? new Map<string, Candidate>();
    const previous = entries.get(key);
    if (previous) {
      previous.default_text ||= default_text;
      const previous_location = previous.location;
      // 同一选项数组可能被多个指令引用，合并条目时仍保留各处关联分支。
      if (previous_location.kind === "field" && location.kind === "field" && location.mirrors) {
        const mirrors = new Map(
          (previous_location.mirrors ?? []).map((path) => [locations.slots.resolve(path), path]),
        );
        for (const path of location.mirrors) mirrors.set(locations.slots.resolve(path), path);
        previous_location.mirrors = [...mirrors.values()];
      }
      return;
    }
    const candidate = { src, location, default_text };
    entries.set(key, candidate);
    seen.set(target, entries);
    candidates.push(candidate);
  }
  // 字段和脚本库解析失败只产生诊断，原始成员仍由容器清单保存。
  async function script(container: Exclude<RGSSContainer, { kind: "block" }>) {
    try {
      const source = read_container(locations.slots, container, version);
      const parsed = await read_ruby_strings(source);
      if (!parsed.ok) {
        warnings.push({
          code: "script_syntax_error",
          rel_path: file,
          location: JSON.stringify(container),
          diagnostics: parsed.diagnostics,
        });
        return;
      }
      for (const { src, ...span } of parsed.strings)
        add(src, { kind: "ruby", container, span }, false);
    } catch (error) {
      warnings.push({
        code: "internal_file_parse_failed",
        rel_path: file,
        location: JSON.stringify(container),
        diagnostics: [
          {
            message: error instanceof Error ? error.message : String(error),
            line: null,
            column: null,
          },
        ],
      });
    }
  }
  const visited = new Set<MarshalNode>(); // 共享父对象只遍历一次，独立字符串槽位仍分别提取。
  // 结构去重独立于用途判定，所有字符串最终进入同一归并入口。
  async function walk(node: MarshalNode, target: RubyPath): Promise<void> {
    const value = base(node);
    if (value.t === '"') {
      add(
        text(node),
        { kind: "field", path: target },
        default_text_slots.has(locations.slots.resolve(target)),
      );
      return;
    }
    if (visited.has(value)) return;
    visited.add(value);
    if (value.t === "[") {
      const list = array(value);
      if (list.length && list.every((entry) => command_kind(entry) !== null))
        await events(list, target);
      else
        for (let index = 0; index < list.length; index++)
          await walk(list[index]!, [...target, index]);
    } else if (value.t === "o" || value.t === "S") {
      for (const [key, entry] of value.pairs!) {
        const key_name = symbol(key);
        await walk(entry, [...target, member(key_name)]);
      }
    } else if (value.t === "{" || value.t === "}") {
      for (let index = 0; index < value.pairs!.length; index++)
        await walk(value.pairs![index]![1], [...target, { entry: index }]);
    }
  }
  // 指令位置提供显示与脚本语义，续行和选项分支使用原稿索引关联。
  async function events(list: MarshalNode[], target: RubyPath): Promise<void> {
    for (let index = 0; index < list.length; index++) {
      const entry = command(list[index]!),
        params = [...target, index, member("@parameters")];
      const continuation = entry.kind === "event" ? BLOCKS.get(entry.code) : undefined;
      if (continuation !== undefined) {
        let end = index + 1;
        while (
          end < list.length &&
          command(list[end]!).kind === "event" &&
          command(list[end]!).code === continuation &&
          command(list[end]!).indent === entry.indent
        )
          end++;
        const location: RGSSContainer = {
          kind: "block",
          path: target,
          start: index,
          end,
          code: entry.code,
        };
        // 事件脚本可能承载自定义协议，因此完整保留。
        add(
          read_container(locations.slots, location, version),
          location,
          entry.code !== EVENT.COMMENT && entry.code !== EVENT.SCRIPT,
        );
        if (entry.code === EVENT.MESSAGE && version !== "xp")
          for (let slot = 0; slot < entry.parameters.length; slot++)
            await walk(entry.parameters[slot]!, [...params, slot]);
        index = end - 1;
        continue;
      }
      if (entry.kind === "event" && entry.code === EVENT.CHOICES) {
        const choices = array(entry.parameters[0]!);
        for (let choice = 0; choice < choices.length; choice++) {
          const mirrors: RubyPath[] = [];
          for (let next = index + 1; next < list.length; next++) {
            const branch = command(list[next]!);
            if (
              branch.indent < entry.indent ||
              (branch.indent === entry.indent && branch.code === EVENT.CHOICES_END)
            )
              break;
            if (
              branch.indent === entry.indent &&
              branch.code === EVENT.CHOICE_BRANCH &&
              integer(branch.parameters[0]!) === choice
            )
              mirrors.push([...target, next, member("@parameters"), 1]);
          }
          add(
            text(choices[choice]!),
            { kind: "field", path: [...params, 0, choice], mirrors },
            true,
          );
        }
        continue;
      }
      if (entry.kind === "event" && entry.code === EVENT.CHOICE_BRANCH) continue;
      const script_slot =
        entry.kind === "event" &&
        entry.code === EVENT.CONDITIONAL &&
        integer(entry.parameters[0]!) === 12
          ? 1
          : entry.kind === "event" &&
              entry.code === EVENT.VARIABLES &&
              version === "ace" && // XP/VX 的操作数类型 4 是角色数据。
              integer(entry.parameters[3]!) === 4
            ? 4
            : entry.kind === "move" && entry.code === EVENT.MOVE_SCRIPT
              ? 0
              : null;
      for (let slot = 0; slot < entry.parameters.length; slot++) {
        if (slot === script_slot) await script({ kind: "field", path: [...params, slot] });
        else if (entry.kind === "event" && ACTOR_TEXT_CODES.has(entry.code) && slot === 1)
          add(text(entry.parameters[slot]!), { kind: "field", path: [...params, slot] }, true);
        else await walk(entry.parameters[slot]!, [...params, slot]);
      }
    }
  }
  if (scripts) {
    const entries = array(root);
    for (let index = 0; index < entries.length; index++) {
      const record = array(entries[index]!);
      assert(record.length === 3, "Invalid RGSS script archive");
      await script({ kind: "archive", path: [index, 2] });
    }
  } else await walk(root, []);
  // 所有入口完成归并后统一生成用途和默认状态，首次发现的路径只负责稳定定位。
  const items = candidates.map(({ src, location, default_text }, row) => {
    const extra_field = {
      rpgmaker_rgss: {
        internal_file_path: file,
        usage: default_text ? "text" : "metadata",
        location: location as unknown as JsonValue,
      },
    };
    return create_item({
      src,
      file_path: file,
      file_type: "RPGMAKER_RGSS",
      row,
      status: rgss_default_status({ extra_field }),
      extra_field,
    });
  });
  return { items, warnings };
}

/** 所有定位、编码和冲突先形成计划，通过后才修改原稿对象。 */
export async function write_rgss_data(
  root: MarshalNode,
  items: readonly Item[],
  version: RGSSVersion,
): Promise<void> {
  const locations = new RGSSLocations(root);
  const groups = new Map<
    WriteTarget,
    { container: RGSSContainer; items: Item[]; mirrors: Set<RubySlot> }
  >();
  for (const item of items) {
    const location = read_rgss_metadata(item.extra_field).location;
    const container = location.kind === "ruby" ? location.container : location;
    const target = locations.resolve(container);
    let group = groups.get(target);
    if (!group) {
      group = { container, items: [], mirrors: new Set() };
      groups.set(target, group);
    }
    assert(group.container.kind === container.kind, "Conflicting RGSS container kinds");
    group.items.push(item);
    if (container.kind === "field")
      for (const mirror of container.mirrors ?? [])
        group.mirrors.add(locations.slots.resolve(mirror));
  }
  const fields = new Map<RubySlot, MarshalNode>();
  const blocks = new Map<
    MarshalNode,
    { target: BlockTarget; container: Extract<RGSSContainer, { kind: "block" }>; value: string }[]
  >();
  // 全部槽位先收集替换值，冲突不会在原稿图上留下部分修改。
  function plan(slot: RubySlot, replacement: MarshalNode): void {
    const previous = fields.get(slot);
    assert(
      !previous || bytes(previous).equals(bytes(replacement)),
      "Conflicting RGSS slot changes",
    );
    fields.set(slot, replacement);
  }
  for (const [target, group] of groups) {
    const original = read_container(locations.slots, group.container, version);
    const ruby = read_rgss_metadata(group.items[0]!.extra_field).location.kind === "ruby";
    let value: string;
    if (ruby) {
      value = await write_ruby_strings(
        original,
        group.items.map((item) => {
          const location = read_rgss_metadata(item.extra_field).location;
          assert(location.kind === "ruby", "Conflicting Ruby container");
          return { span: location.span, src: item.src, dst: item.dst };
        }),
      );
    } else {
      value = group.items[0]!.dst;
      for (const item of group.items) {
        assert(
          read_rgss_metadata(item.extra_field).location.kind !== "ruby" && item.src === original,
          "Stale RGSS location",
        );
        assert(item.dst === value, "Conflicting RGSS slot changes");
      }
    }
    if (group.container.kind === "block") {
      assert("list" in target);
      const entries = blocks.get(target.list) ?? [];
      entries.push({ target, container: group.container, value });
      blocks.set(target.list, entries);
    } else {
      assert("parent" in target);
      const node = read_slot(target);
      if (group.container.kind === "archive") {
        const script = read_rgss_script(node);
        if (script.source !== value)
          plan(target, replace_bytes(node, deflateSync(write_text(value, script.encoding))));
      } else {
        for (const mirror of group.mirrors) {
          assert(text(read_slot(mirror)) === original, "Stale choice mirror");
          plan(mirror, replace_text(read_slot(mirror), value));
        }
        plan(target, replace_text(node, value));
      }
    }
  }
  const replacements: {
    list: MarshalNode[];
    start: number;
    end: number;
    commands: MarshalNode[];
  }[] = [];
  for (const [node, group] of blocks) {
    const list = array(node);
    let previous = list.length;
    for (const { target, container, value } of group.sort(
      (a, b) => b.target.start - a.target.start,
    )) {
      assert(target.end <= previous, "Overlapping RGSS blocks");
      previous = target.start;
      const header = list[target.start]!,
        entry = command(header),
        continuation = BLOCKS.get(entry.code)!;
      const first =
        (entry.code === EVENT.MESSAGE && version !== "xp") || entry.code === EVENT.SCROLLING
          ? target.start + 1
          : target.start;
      for (let index = first; index < target.end; index++) {
        const slot = locations.slots.resolve([...container.path, index, member("@parameters"), 0]);
        assert(!fields.has(slot), "Conflicting RGSS block field");
      }
      // 新指令保留头指令结构，原设置数组继续接收计划中的字段修改。
      const clone_header = () => {
        const clone = decode(encode(header));
        write_slot(
          new RubySlots(clone).resolve([member("@parameters")]),
          field(header, "@parameters")!,
        );
        return clone;
      };
      const template = command(list[first]!).parameters[0]!;
      // 沿用原字符串编码，将文本行写入新指令。
      const make = (code: number, line: string) => {
        const clone = clone_header(),
          slots = new RubySlots(clone);
        write_slot(slots.resolve([member("@code")]), { t: "i", value: code });
        write_slot(slots.resolve([member("@parameters")]), {
          t: "[",
          items: [replace_text(template, line)],
        });
        return clone;
      };
      const commands: MarshalNode[] = [];
      value.split(/\r\n|\n|\r/u).forEach((line, index) => {
        if (entry.code === EVENT.MESSAGE && index % MESSAGE_LINES === 0) {
          if (version === "xp") {
            commands.push(make(EVENT.MESSAGE, line));
            return;
          }
          commands.push(clone_header());
        } else if (entry.code === EVENT.SCROLLING && index === 0) commands.push(clone_header());
        commands.push(
          make(
            index === 0 && (entry.code === EVENT.COMMENT || entry.code === EVENT.SCRIPT)
              ? entry.code
              : continuation,
            line,
          ),
        );
      });
      replacements.push({ list, start: target.start, end: target.end, commands });
    }
  }
  for (const [slot, replacement] of fields) write_slot(slot, replacement);
  for (const replacement of replacements)
    replacement.list.splice(
      replacement.start,
      replacement.end - replacement.start,
      ...replacement.commands,
    );
}
