import assert from "node:assert/strict";
import { open_wolf_document, WolfReader, type WolfDocument } from "./binary";
import { read_wolf_command, WOLF_COMMAND, type WolfCommand } from "./commands";
import { RESOURCE_EXTENSIONS } from "../../../shared/text/text-resource-reference";

const MAGIC = [0, 0x57, 0, 0, 0x4f, 0x4c, 0, 0x46, 0x43, 0];
const VERSIONS = [0x90, 0x91, 0x93, 0xcc]; // 支持的布局版本。
const COMPRESSED = [0x93, 0xcc]; // 其中使用 LZ4 封装的版本。
const SELF_VARIABLE_BASE = 1600000; // 变量编号 1600000 + k 指所在公共事件的 \cself[k]。
const DATABASE_READ = 1; // `250` 标志位 12–15 为该值时，从数据库读入变量。
// `250` 标志位 8–11 选择数据库，按编号排列为对应文件的路径主干。
const DATABASE_FILES = [
  "data/basicdata/cdatabase",
  "data/basicdata/sysdatabase",
  "data/basicdata/database",
];
// 扩展名后不能紧跟字母或数字，避免把 `.dat_backup` 这类词误判为资源路径。
const RESOURCE_PATTERN = new RegExp(
  String.raw`\.(?:${RESOURCE_EXTENSIONS.join("|")})(?![\p{L}\p{N}])`,
  "iu",
);
const SELF_REFERENCE_PATTERN = /\\cself\[(\d+)\]/giu; // 字符串中引用的 `\cself[k]`。

/** 公共事件的解析结果，`event` 为物理下标，`id` 为文件中的事件 ID。 */
export type WolfCommonEvent = Readonly<{
  event: number;
  id: number;
  name: string;
  description: string;
  commands: readonly WolfCommand[];
}>;
/** 按名称或编号指定的数据库字段，`database` 为文件路径主干的小写形式。 */
export type WolfFieldReference = Readonly<{
  database: string;
  type: string | number;
  field: string | number;
}>;

/** 事件 ID 用作上下文，写回使用原稿数组中的物理位置。 */
export function read_wolf_common(
  input: Uint8Array,
): WolfDocument & { details: { version: number; events: WolfCommonEvent[] } } {
  const doc = open_wolf_document(input, MAGIC, 6, 10, VERSIONS, COMPRESSED, 11);
  const reader = new WolfReader(doc.bytes, 11, doc.utf8),
    events: WolfCommonEvent[] = [];
  for (let count = reader.count(), event = 0; event < count; event++) {
    reader.expect(0x8e);
    const id = reader.uint();
    reader.take(11);
    const name = reader.string({ kind: "common_name", event }, "metadata", "Event " + id),
      commands: WolfCommand[] = [];
    for (let n = reader.count(), command = 0; command < n; command++)
      commands.push(
        read_wolf_command(
          reader,
          { kind: "common_command", event, command },
          doc.compression !== null,
        ),
      );
    const description = reader.string();
    reader.string();
    reader.expect(0x8f);
    for (let n = reader.count(); n; n--) reader.string();
    reader.take(reader.count());
    for (let n = reader.count(); n; n--) for (let m = reader.count(); m; m--) reader.string();
    for (let n = reader.count(); n; n--) reader.take(reader.count() * 4);
    reader.take(29);
    for (let i = 0; i < 100; i++) reader.string();
    reader.expect(0x91);
    reader.string();
    const end = reader.byte();
    if (end === 0x92) {
      reader.string();
      reader.uint();
      reader.expect(0x92);
    } else assert.equal(end, 0x91, "Unsupported WOLF common event tail");
    events.push({ event, id, name, description, commands });
  }
  assert(reader.byte() >= 0x89, "Invalid WOLF common file terminator");
  reader.done();
  doc.slots = reader.slots;
  return Object.assign(doc, { details: { version: doc.bytes[10]!, events } });
}

/**
 * 含资源扩展名的指令字符串把 `\cself[k]` 拼进路径时，读入该变量的数据库字段值是路径组件。
 * 同一事件内的全部读取都计入，分支和循环使静态顺序不能代表执行顺序。
 */
export function read_wolf_path_fields(events: readonly WolfCommonEvent[]): WolfFieldReference[] {
  const fields: WolfFieldReference[] = [];
  for (const { commands } of events) {
    const variables = new Set(
      commands.flatMap(({ strings }) =>
        strings
          .filter((text) => RESOURCE_PATTERN.test(text))
          .flatMap((text) =>
            [...text.matchAll(SELF_REFERENCE_PATTERN)].map(
              (match) => SELF_VARIABLE_BASE + Number(match[1]),
            ),
          ),
      ),
    );
    for (const { code, integers, strings } of commands) {
      const [type, , field, flags = 0, target = -1] = integers;
      const database = DATABASE_FILES[(flags >>> 8) & 15];
      if (
        code !== WOLF_COMMAND.DATABASE ||
        !variables.has(target) ||
        ((flags >>> 12) & 15) !== DATABASE_READ ||
        !database
      )
        continue;
      // 字符串参数 1 和 3 非空时按名称指定类型和字段，为空时使用整数编号。
      fields.push({ database, type: strings[1] || type!, field: strings[3] || field! });
    }
  }
  return fields;
}
