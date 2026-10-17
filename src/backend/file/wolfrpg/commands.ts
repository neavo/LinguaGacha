import assert from "node:assert/strict";
import { WolfReader } from "./binary";
import type { WolfLocation } from "./item";

export const WOLF_COMMAND = {
  MESSAGE: 101,
  CHOICES: 102,
  COMMENT: 103,
  DEBUG: 106,
  SET_STRING: 122,
  PICTURE: 150,
  DATABASE: 250,
} as const;
export type WolfCommand = Readonly<{
  code: number;
  integers: readonly number[];
  strings: readonly string[];
  indent: number;
}>;
type CommandLocation =
  | { kind: "common_command"; event: number; command: number }
  | { kind: "map_command"; event: number; page: number; command: number };

/** 移动路线的参数属于整数协议，保留原字节即可。 */
export function read_wolf_route(reader: WolfReader): void {
  reader.byte();
  reader.take(reader.byte() * 4);
  reader.expect(1);
  reader.expect(0);
}

/** 用途按指令和子类型解释，未知操作数默认人工放行。 */
function command_usage(
  code: number,
  integers: readonly number[],
  string: number,
): "text" | "metadata" {
  if (code === WOLF_COMMAND.MESSAGE || code === WOLF_COMMAND.CHOICES) return "text";
  if (
    code === WOLF_COMMAND.PICTURE &&
    integers.length &&
    ((integers[0]! >>> 4) & 7) === 2 &&
    string === 0
  )
    return "text";
  if (
    code === WOLF_COMMAND.SET_STRING &&
    integers.length >= 2 &&
    ((integers[1]! >>> 8) & 255) === 0 &&
    string === 0
  )
    return "text";
  return "metadata";
}

/** 指令尾部的路线与新版本附加字节属于本条指令，不能按文本外观跳过。 */
export function read_wolf_command(
  reader: WolfReader,
  location: CommandLocation,
  extended: boolean,
): WolfCommand {
  const count = reader.byte();
  assert(count >= 1, "Invalid WOLF command argument count");
  const code = reader.uint(),
    integers: number[] = [];
  for (let i = 1; i < count; i++) integers.push(reader.uint());
  const indent = reader.byte(),
    strings: string[] = [],
    string_count = reader.byte();
  for (let string = 0; string < string_count; string++) {
    const slot: WolfLocation = { ...location, code, string };
    strings.push(
      reader.string(
        code === WOLF_COMMAND.COMMENT || code === WOLF_COMMAND.DEBUG ? undefined : slot,
        command_usage(code, integers, string),
        JSON.stringify({ ...location, code, integers }),
      ),
    );
  }
  const end = reader.byte();
  if (end === 1) {
    reader.take(6);
    for (let n = reader.count(); n; n--) read_wolf_route(reader);
  } else assert.equal(end, 0, "Unsupported WOLF command tail");
  if (extended) reader.take(reader.byte());
  return { code, integers, strings, indent };
}
