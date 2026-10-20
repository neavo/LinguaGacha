import assert from "node:assert/strict";
import path from "node:path";
import type { NativeFs } from "../../../../native/native-fs";
import { read_game_source_files, type GameSource } from "./source-files";
import { GAME_FONT_EXTENSIONS } from "../../../../shared/game-font";
import { encode_wolf_string, replace_wolf_slots } from "../../wolfrpg/binary";
import { read_wolf_game } from "../../wolfrpg/game-data";
import type { RPGMakerSource } from "../../rpgmaker-mv-mz/source";
import { write_game_backup } from "./backup";
import { prepare_game_directory } from "./prepare";
import type { GamePrepareExecution } from "./prepare-worker";

export type GameFontSource = Extract<GameSource, { file_type: "WOLFRPG" | "RPGMAKER_MV_MZ" }>;
export type GameFont = Readonly<{
  bytes: Uint8Array;
  file_name: string;
  families: readonly string[]; // 同一字体的内部族名别名，英文在前；仅 WOLF 按名称加载。
}>;

const WOLF_FONT_SLOTS = [3, 4, 5, 6]; // `Game.dat` 的主字体与三个子字体。

/** 解包结果与字体修改合成一份清单，由目录事务一次提交。 */
export async function replace_game_font(
  source: GameFontSource,
  font: GameFont,
  fs: NativeFs,
  execute: GamePrepareExecution,
  signal?: AbortSignal,
): Promise<void> {
  const root = source.game.root;
  await prepare_game_directory(
    root,
    fs,
    async (staging) => {
      const prepared = await execute({ ...source, staging }, signal);
      signal?.throwIfAborted();
      const writes = new Set(prepared.writes);
      const files = read_game_source_files(source, fs, signal, { staging, result: prepared });
      const outputs =
        source.file_type === "WOLFRPG"
          ? wolf_font_outputs(files.data, files.fonts, font)
          : mv_mz_font_outputs(source.game, files.fonts, font);
      // 修改暂存文件前已读定原字节，备份成功后才允许游戏事务提交。
      await write_game_backup(root, new Map([...files.data, ...files.fonts]), fs, signal);
      for (const [name, bytes] of outputs) {
        signal?.throwIfAborted();
        const target = path.join(staging, name);
        await fs.make_dir_async(path.dirname(target));
        await fs.write_file(target, bytes);
        writes.add(name);
      }
      return { ...prepared, writes: [...writes] };
    },
    signal,
  );
}

/** 字体复制到游戏根目录，`Game.dat` 四个字体槽位统一写入字体内部名称。 */
function wolf_font_outputs(
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

/** 按原路径写入所选字体，引擎按内容识别字体格式，因此所有加载引用无需改写。 */
function mv_mz_font_outputs(
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

/** 沿用已有拼写，避免只差大小写的新路径与原文件冲突。 */
function find_name(names: Iterable<string>, name: string): string | undefined {
  const key = name.toLowerCase();
  for (const candidate of names) if (candidate.toLowerCase() === key) return candidate;
  return undefined;
}
