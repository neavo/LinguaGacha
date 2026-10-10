import { RPGMAKER_EVENT } from "./types";
import path from "node:path";
import { create_item, type Item, type ItemStatus } from "../../../domain/item";
import { read_json_record, type JsonValue } from "../../../domain/json";
import { read_javascript_strings } from "./javascript";
import type { JsonPath, RPGMakerLocation, RPGMakerMetadata } from "./types";

type Command = { code: number; indent: number; parameters: JsonValue[] };
const DISPLAY_FIELDS: Record<string, readonly string[]> = {
  Actors: ["name", "nickname", "profile"],
  Classes: ["name"],
  Skills: ["name", "description", "message1", "message2"],
  Items: ["name", "description"],
  Weapons: ["name", "description"],
  Armors: ["name", "description"],
  Enemies: ["name"],
  States: ["name", "message1", "message2", "message3", "message4"],
};
const SYSTEM_DISPLAY_FIELDS = new Set([
  "gameTitle",
  "currencyUnit",
  "elements",
  "skillTypes",
  "weaponTypes",
  "armorTypes",
  "equipTypes",
  "terms",
]);
const BLOCK_CODES = new Map<number, number>([
  [RPGMAKER_EVENT.MESSAGE, RPGMAKER_EVENT.MESSAGE_LINE],
  [RPGMAKER_EVENT.SCROLLING, RPGMAKER_EVENT.SCROLLING_LINE],
  [RPGMAKER_EVENT.COMMENT, RPGMAKER_EVENT.COMMENT_LINE],
  [RPGMAKER_EVENT.SCRIPT, RPGMAKER_EVENT.SCRIPT_LINE],
]);
const ACTOR_TEXT_CODES = new Set<number>([
  RPGMAKER_EVENT.ACTOR_NAME,
  RPGMAKER_EVENT.ACTOR_NICKNAME,
  RPGMAKER_EVENT.ACTOR_PROFILE,
]);

/** 按事件结构提取定位，显示用途只决定首次导入和重置的默认状态。 */
export function read_rpgmaker_json(root: JsonValue, rel_path: string): Item[] {
  const items: Item[] = [];
  const file = path.basename(rel_path, ".json");
  // 空正文仍可携带说话人，必须保留可翻译姓名。
  function add(
    src: string,
    location: RPGMakerLocation,
    usage: RPGMakerMetadata["usage"],
    name_src: string | null = null,
  ): void {
    if (src === "" && !name_src) return;
    const extra_field = { rpgmaker: { usage, location } };
    items.push(
      create_item({
        src,
        name_src,
        file_path: rel_path,
        file_type: "RPGMAKER_MV_MZ",
        row: items.length,
        status: rpgmaker_default_status({ extra_field }),
        extra_field,
      }),
    );
  }
  // 脚本偏移相对于完整容器，事件行重新连接后再交给解析器。
  function script(src: string, container: Exclude<RPGMakerLocation, { kind: "script" }>): void {
    for (const span of read_javascript_strings(src))
      add(
        span.src,
        { kind: "script", container, start: span.start, end: span.end, template: span.template },
        "script",
      );
  }
  // 显示字段向下传播用途，插件扩展字段保留为默认排除条目。
  function walk(value: JsonValue, target: JsonPath, display = false): void {
    if (typeof value === "string") {
      add(value, { kind: "field", path: target }, display ? "display" : "metadata");
    } else if (Array.isArray(value)) {
      if (target.at(-1) === "list" && value.length > 0 && value.every(is_command)) {
        events(value, target);
      } else value.forEach((entry, index) => walk(entry, [...target, index], display));
    } else if (value !== null && typeof value === "object") {
      for (const [key, entry] of Object.entries(value)) {
        const visible =
          display ||
          (target.length === 1 &&
            typeof target[0] === "number" &&
            (DISPLAY_FIELDS[file]?.includes(key) ?? false)) ||
          (target.length === 0 &&
            ((file === "System" && SYSTEM_DISPLAY_FIELDS.has(key)) ||
              (/^Map\d+$/u.test(file) && key === "displayName")));
        walk(entry, [...target, key], visible);
      }
    }
  }
  // 文本块和选项关联字段共用原始指令索引，供写回重建。
  function events(list: Command[], list_path: JsonPath): void {
    for (let index = 0; index < list.length; index++) {
      const command = list[index]!;
      const parameters_path = [...list_path, index, "parameters"];
      const continuation = BLOCK_CODES.get(command.code);
      if (continuation !== undefined) {
        const first =
          command.code === RPGMAKER_EVENT.COMMENT || command.code === RPGMAKER_EVENT.SCRIPT
            ? index
            : index + 1;
        let end = index + 1;
        while (list[end]?.code === continuation && list[end]?.indent === command.indent) end++;
        const code =
          command.code === RPGMAKER_EVENT.SCRIPT
            ? RPGMAKER_EVENT.SCRIPT
            : command.code === RPGMAKER_EVENT.COMMENT
              ? RPGMAKER_EVENT.COMMENT
              : continuation;
        const location: Extract<RPGMakerLocation, { kind: "block" }> = {
          kind: "block",
          path: list_path,
          start: first,
          end,
          code,
        };
        const text = list
          .slice(first, end)
          .map((entry) => String(entry.parameters[0] ?? ""))
          .join("\n");
        const name =
          command.code === RPGMAKER_EVENT.MESSAGE && typeof command.parameters[4] === "string"
            ? command.parameters[4]
            : null;
        if (name !== null) location.name_path = [...parameters_path, 4];
        if (command.code === RPGMAKER_EVENT.SCRIPT) script(text, location);
        else
          add(
            text,
            location,
            command.code === RPGMAKER_EVENT.COMMENT ? "metadata" : "display",
            name,
          );
        // 头指令的资源字段也保留为默认排除条目。
        if (command.code === RPGMAKER_EVENT.MESSAGE)
          command.parameters.forEach((entry, slot) => {
            if (slot !== 4) walk(entry, [...parameters_path, slot]);
          });
        index = end - 1;
        continue;
      }
      if (command.code === RPGMAKER_EVENT.CHOICES && Array.isArray(command.parameters[0])) {
        command.parameters[0].forEach((choice, choice_index) => {
          if (typeof choice !== "string") return;
          const mirrors: JsonPath[] = [];
          for (let next = index + 1; next < list.length; next++) {
            const branch = list[next]!;
            if (
              branch.indent < command.indent ||
              (branch.indent === command.indent && branch.code === RPGMAKER_EVENT.CHOICES_END)
            )
              break;
            if (
              branch.indent === command.indent &&
              branch.code === RPGMAKER_EVENT.CHOICE_BRANCH &&
              branch.parameters[0] === choice_index
            )
              mirrors.push([...list_path, next, "parameters", 1]);
          }
          add(
            choice,
            { kind: "field", path: [...parameters_path, 0, choice_index], mirrors },
            "display",
          );
        });
        continue;
      }
      if (command.code === RPGMAKER_EVENT.CHOICE_BRANCH) continue; // 选项分支由对应选项同步写回。
      const script_slot =
        command.code === RPGMAKER_EVENT.CONDITIONAL && command.parameters[0] === 12
          ? 1
          : command.code === RPGMAKER_EVENT.VARIABLES && command.parameters[3] === 4
            ? 4
            : command.code === RPGMAKER_EVENT.MOVE_SCRIPT
              ? 0
              : null;
      command.parameters.forEach((entry, slot) => {
        const target = [...parameters_path, slot];
        if (slot === script_slot && typeof entry === "string")
          script(entry, { kind: "field", path: target });
        else walk(entry, target, ACTOR_TEXT_CODES.has(command.code) && slot === 1);
      });
    }
  }
  walk(root, []);
  return items;
}

/** 事件列表需与普通对象数组区分，嵌套移动路线也沿用指令结构。 */
function is_command(value: JsonValue): value is Command {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof value["code"] === "number" &&
    Array.isArray(value["parameters"])
  );
}

/** 仅提取与明确重置调用，普通编辑和生成尊重当前状态。 */
export function rpgmaker_default_status(item: Pick<Item, "extra_field">): ItemStatus {
  return read_json_record(read_json_record(item.extra_field)["rpgmaker"])["usage"] === "display"
    ? "NONE"
    : "RULE_SKIPPED";
}
