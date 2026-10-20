import assert from "node:assert/strict";
import path from "node:path";
import { GAME_FONT_EXTENSIONS } from "../../../shared/game-font";
import type { RPGMakerSource } from "./source";
import type { GameFont } from "../shared/game/font-replace";

/** 按原路径写入所选字体，引擎按内容识别字体格式，因此所有加载引用无需改写。 */
export function mv_mz_font_outputs(
  game: RPGMakerSource,
  files: ReadonlyMap<string, Uint8Array>,
  font: GameFont,
): Map<string, Uint8Array> {
  const prefix = path.relative(game.root, game.data_root).replaceAll("\\", "/");
  const fonts = [prefix, "fonts"].filter(Boolean).join("/");
  const originals = [...files.keys()].filter(
    (name) =>
      path.posix.dirname(name).toLowerCase() === fonts.toLowerCase() &&
      GAME_FONT_EXTENSIONS.includes(path.extname(name).slice(1).toLowerCase()),
  );
  assert(originals.length, "No font files found: " + fonts);
  return new Map(originals.map((name) => [name, font.bytes]));
}
