import { RPGMAKER_EVENT } from "../shared/rpgmaker-event";
import type { Item } from "../../../domain/item";
import type { JsonValue } from "../../../domain/json";
import { create_rpgmaker_extractor } from "./extractor";
import type { JsonPath, RPGMakerLocation } from "./types";
import type { SourceFileParseWarning } from "../file-format-types";

type Command = { code: number; indent: number; parameters: JsonValue[] };
const DEFAULT_TEXT_FIELDS: Record<string, readonly string[]> = {
  Actors: ["name", "nickname", "profile"],
  Classes: ["name"],
  Skills: ["name", "description", "message1", "message2"],
  Items: ["name", "description"],
  Weapons: ["name", "description"],
  Armors: ["name", "description"],
  Enemies: ["name"],
  States: ["name", "message1", "message2", "message3", "message4"],
}; // 引擎标准字段默认参与翻译，插件扩展字段保留为元数据。
const SYSTEM_DEFAULT_TEXT_FIELDS = new Set([
  "gameTitle",
  "currencyUnit",
  "elements",
  "skillTypes",
  "weaponTypes",
  "armorTypes",
  "equipTypes",
  "terms",
]); // `System` 的词典与分类名称向子项传播默认翻译资格，是否被按名称引用由领域审校判断。
const DATABASE_FILE_PATTERN = /^(?:www\/)?data\/([^/]+)\.json$/iu; // 标准数据库只位于数据根的直接成员，扩展名与采集规则一致。
const BLOCK_CODES = new Map<number, number>([
  [RPGMAKER_EVENT.MESSAGE, RPGMAKER_EVENT.MESSAGE_LINE],
  [RPGMAKER_EVENT.SCROLLING, RPGMAKER_EVENT.SCROLLING_LINE],
  [RPGMAKER_EVENT.COMMENT, RPGMAKER_EVENT.COMMENT_LINE],
  [RPGMAKER_EVENT.SCRIPT, RPGMAKER_EVENT.SCRIPT_LINE],
]); // 头指令与续行配对，组成保留原稿索引的文本块。
const ACTOR_TEXT_CODES = new Set<number>([
  RPGMAKER_EVENT.ACTOR_NAME,
  RPGMAKER_EVENT.ACTOR_NICKNAME,
  RPGMAKER_EVENT.ACTOR_PROFILE,
]); // 角色名、昵称与介绍的 `parameters[1]` 默认参与翻译。

/** 数据库文件决定默认翻译字段，事件结构决定文本块与脚本，用途只决定首次导入和文件重置的默认状态。 */
export function read_rpgmaker_json(
  root: JsonValue,
  rel_path: string,
): { items: Item[]; warnings: SourceFileParseWarning[] } {
  const { items, warnings, add, expand, script } = create_rpgmaker_extractor(rel_path);
  const file = DATABASE_FILE_PATTERN.exec(rel_path)?.[1] ?? ""; // 子目录同名文件不触发数据库字段规则。
  // 默认翻译字段整段保存并向下传播资格，其余字符串可能是插件 JSON，展开后保留为默认排除条目。
  function walk(value: JsonValue, target: JsonPath, default_text = false): void {
    if (typeof value === "string") {
      (default_text ? add : expand)(value, {
        location: { kind: "field", path: target },
        usage: default_text ? "text" : "metadata",
      });
    } else if (Array.isArray(value)) {
      if (target.at(-1) === "list" && value.length > 0 && value.every(is_command)) {
        events(value, target);
      } else value.forEach((entry, index) => walk(entry, [...target, index], default_text));
    } else if (value !== null && typeof value === "object") {
      for (const [key, entry] of Object.entries(value)) {
        const field_text =
          default_text ||
          (target.length === 1 &&
            typeof target[0] === "number" &&
            (DEFAULT_TEXT_FIELDS[file]?.includes(key) ?? false)) ||
          (target.length === 0 &&
            ((file === "System" && SYSTEM_DEFAULT_TEXT_FIELDS.has(key)) ||
              (/^Map\d+$/u.test(file) && key === "displayName")));
        walk(entry, [...target, key], field_text);
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
        const includes_header =
          command.code === RPGMAKER_EVENT.COMMENT || command.code === RPGMAKER_EVENT.SCRIPT; // 注释和脚本的头指令自身携带正文。
        const first = includes_header ? index : index + 1;
        let end = index + 1;
        while (list[end]?.code === continuation && list[end]?.indent === command.indent) end++;
        const code = includes_header ? command.code : continuation;
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
        // 事件脚本可能承载插件自定义协议，因此完整保留。
        add(
          text,
          {
            location,
            usage: includes_header ? "metadata" : "text",
          },
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
          add(choice, {
            location: { kind: "field", path: [...parameters_path, 0, choice_index], mirrors },
            usage: "text",
          });
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
  return { items, warnings };
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
