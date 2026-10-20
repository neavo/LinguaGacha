import assert from "node:assert/strict";
import { encode_wolf_string, replace_wolf_slots } from "./binary";
import { read_wolf_game } from "./game-data";
import type { GameFont } from "../shared/game/font-replace";

const WOLF_FONT_SLOTS = [3, 4, 5, 6]; // `Game.dat` 的主字体与三个子字体。

/** 字体复制到游戏根目录，`Game.dat` 四个字体槽位统一写入字体内部名称。 */
export function wolf_font_outputs(
  data: ReadonlyMap<string, Uint8Array>,
  fonts: ReadonlyMap<string, Uint8Array>,
  font: GameFont,
): Map<string, Uint8Array> {
  const game = find_name(data.keys(), "Data/BasicData/Game.dat");
  assert(game, "Missing WOLF Game.dat");
  const document = read_wolf_game(data.get(game)!);
  const slots = document.slots.filter(
    (slot) =>
      slot.location.kind === "game_string" && WOLF_FONT_SLOTS.includes(slot.location.string),
  );
  // 别名都能加载同一字体，取第一个能按游戏编码保存的名称。
  const family = font.families.find((name) => {
    try {
      encode_wolf_string(name, document.utf8);
      return true;
    } catch {
      return false; // 编码失败只说明该别名不可用，继续尝试其它别名。
    }
  });
  if (family === undefined)
    throw new Error("Font name cannot be stored in this WOLF game: " + font.families.join(", "));
  return new Map([
    [game, replace_wolf_slots(document, new Map(slots.map((slot) => [slot, family])))],
    [find_name(fonts.keys(), font.file_name) ?? font.file_name, font.bytes],
  ]);
}

/** 沿用已有拼写，避免只差大小写的新路径与原文件冲突。 */
function find_name(names: Iterable<string>, name: string): string | undefined {
  const key = name.toLowerCase();
  for (const candidate of names) if (candidate.toLowerCase() === key) return candidate;
  return undefined;
}
