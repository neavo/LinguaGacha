import assert from "node:assert/strict";
import path from "node:path";
import type { NativeFs } from "../../../../native/native-fs";
import { collect_existing_files } from "../../source-file-paths";
import { encode_wolf_string, replace_wolf_slots } from "../../wolfrpg/binary";
import { read_wolf_game } from "../../wolfrpg/game-data";
import type { WolfSource } from "../../wolfrpg/source";
import type { RPGMakerSource } from "../../rpgmaker-mv-mz/source";
import { write_game_backup } from "./backup";
import { prepare_game_directory } from "./prepare";
import type { GamePrepareExecution } from "./prepare-worker";

export type GameFontSource =
  | Readonly<{ kind: "wolfrpg"; game: WolfSource }>
  | Readonly<{ kind: "mv_mz"; game: RPGMakerSource }>;
export type GameFont = Readonly<{
  bytes: Uint8Array;
  file_name: string;
  families: readonly string[]; // 同一字体的内部族名别名，英文在前；仅 WOLF 按名称加载。
}>;

const WOLF_FONT_SLOTS = [3, 4, 5, 6]; // `Game.dat` 的主字体与三个子字体。
const MV_MZ_FONT_EXTENSIONS = new Set([".ttf", ".otf", ".woff", ".woff2"]); // MV/MZ 能加载的字体格式。

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
      // 已暂存的解包结果优先，字体修改基于它而不是原目录中的旧字节。
      const read = (name: string) =>
        fs.read_file(path.join(writes.has(name) ? staging : root, name));
      const outputs =
        source.kind === "wolfrpg"
          ? wolf_font_outputs(root, writes, read, font, fs)
          : mv_mz_font_outputs(source.game, writes, font, fs);
      const backup = new Map<string, Uint8Array>();
      for (const name of outputs.keys())
        if (writes.has(name) || fs.exists(path.join(root, name))) backup.set(name, read(name));
      for (const [name, bytes] of outputs) {
        signal?.throwIfAborted();
        const target = path.join(staging, name);
        await fs.make_dir_async(path.dirname(target));
        await fs.write_file(target, bytes);
        writes.add(name);
      }
      // 事务回滚副本在成功后清理，用户可恢复的原文件须在提交前另存。
      if (backup.size) await write_game_backup(root, backup, fs, signal);
      return { ...prepared, writes: [...writes] };
    },
    signal,
  );
}

/** 字体复制到游戏根目录，`Game.dat` 四个字体槽位统一写入字体内部名称。 */
function wolf_font_outputs(
  root: string,
  writes: ReadonlySet<string>,
  read: (name: string) => Uint8Array,
  font: GameFont,
  fs: NativeFs,
): Map<string, Uint8Array> {
  const known = new Set(writes);
  collect_existing_files(root, "Data/BasicData", known, fs);
  const game = find_name(known, "Data/BasicData/Game.dat");
  assert(game, "Missing WOLF Game.dat");
  const document = read_wolf_game(read(game));
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
  const root_files = fs
    .read_dirents(root)
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  return new Map([
    [game, replace_wolf_slots(document, new Map(slots.map((slot) => [slot, family])))],
    [find_name([...root_files, ...writes], font.file_name) ?? font.file_name, font.bytes],
  ]);
}

/** 按原路径写入所选字体，引擎按内容识别字体格式，因此所有加载引用无需改写。 */
function mv_mz_font_outputs(
  game: RPGMakerSource,
  writes: ReadonlySet<string>,
  font: GameFont,
  fs: NativeFs,
): Map<string, Uint8Array> {
  const prefix = path.relative(game.root, game.data_root).replaceAll("\\", "/");
  const fonts = [prefix, "fonts"].filter(Boolean).join("/");
  const known = new Set(writes);
  collect_existing_files(game.root, fonts, known, fs);
  const originals = [...known].filter(
    (name) =>
      path.posix.dirname(name).toLowerCase() === fonts.toLowerCase() &&
      MV_MZ_FONT_EXTENSIONS.has(path.extname(name).toLowerCase()),
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
