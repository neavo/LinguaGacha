import path from "node:path";
import type { NativeFs } from "../../../native/native-fs";
import { assert_regular_path, GameSourceConflictError } from "../source-file-paths";
import { read_bytes } from "../shared/binary";
import { classify_wolf_archive, classify_wolf_key, type WolfKeyType } from "./archive-crypt";
import { resolve_game_source_input } from "../shared/game/source-input";

export type WolfSource = Readonly<{
  root: string;
  data_root: string;
  key_files: readonly Readonly<{ source_path: string; type: WolfKeyType }>[];
  archives: readonly Readonly<{ source_path: string; output_prefix: string }>[];
}>;

// 加密工具可改写归档扩展名，候选仍需通过文件头确认。
const ARCHIVE_EXTENSIONS = [
  ".wolf",
  ".data",
  ".pak",
  ".bin",
  ".assets",
  ".content",
  ".res",
  ".resource",
];
const KEY_NAMES = new Set(["game", "list", "data2", "gamefile", "basicdata2"]); // 可能保存配套密钥的主名。
// 任一标志存在即确定游戏根目录。
const LAYOUT_MARKERS = [
  ...ARCHIVE_EXTENSIONS.flatMap((ext) => ["Data" + ext, "Data/BasicData" + ext]),
  "Data/BasicData/Game.dat",
  "Data/BasicData/Game.dat.wolfx",
];

/** 只使用布局标志确定游戏边界，坏游戏不能降级为普通目录。 */
export function wolf_source_root(source: string, fs: NativeFs): string | null {
  const input = resolve_game_source_input(source, fs);
  if (!input) return null;
  const candidate = input.root;
  const roots =
    path.basename(candidate).toLowerCase() === "data"
      ? [candidate, path.dirname(candidate)]
      : [candidate];
  return (
    roots.find((root) => LAYOUT_MARKERS.some((name) => fs.exists(path.join(root, name)))) ?? null
  );
}

/** EXE 名称和版本不决定协议支持范围，归档头给出常规加密标记。 */
export async function discover_wolf_source(
  source: string,
  fs: NativeFs,
  signal?: AbortSignal,
): Promise<WolfSource | null> {
  const root = wolf_source_root(source, fs);
  if (!root) return null;
  assert_regular_path(root, fs);
  const data_root = path.join(root, "Data"),
    archives: Array<{ source_path: string; output_prefix: string }> = [],
    key_files: Array<{ source_path: string; type: WolfKeyType }> = [],
    headers = new Map<string, Buffer>();
  for (const directory of [root, data_root]) {
    if (!fs.exists(directory)) continue;
    assert_regular_path(directory, fs);
    for (const entry of fs.read_dirents(directory)) {
      signal?.throwIfAborted();
      const parsed = path.parse(entry.name),
        stem = parsed.name.toLowerCase(),
        ext = parsed.ext.toLowerCase();
      if (!ARCHIVE_EXTENSIONS.includes(ext)) continue;
      const key_candidate = KEY_NAMES.has(stem);
      const archive_candidate = directory === data_root || stem === "data";
      if (!key_candidate && !archive_candidate) continue;
      const source_path = path.join(directory, entry.name);
      assert_regular_path(source_path, fs);
      if (!entry.isFile()) throw new Error("Invalid WOLF archive: " + source_path);
      const handle = await fs.open_file(source_path, "r");
      let header: Buffer;
      try {
        header = await read_bytes(handle, 0, Math.min(64, (await handle.stat()).size));
      } finally {
        await handle.close();
      }
      const type = key_candidate ? classify_wolf_key(header) : null;
      if (type) {
        key_files.push({ source_path, type });
        continue;
      }
      if (!archive_candidate) continue;
      const dx = header.length >= 2 && header.readUInt16LE() === 0x5844;
      if (!dx && ext !== ".wolf" && stem !== "data" && stem !== "basicdata") continue;
      archives.push({
        source_path,
        output_prefix: directory === root ? "Data" : "Data/" + parsed.name,
      });
      headers.set(source_path, header);
    }
  }
  // 根包与分包的优先级未定义，沿用来源冲突边界。
  if (archives.some((archive) => archive.output_prefix === "Data") && archives.length > 1)
    throw new GameSourceConflictError("Conflicting WOLF data archives: " + root);
  for (const archive of archives) {
    try {
      if (classify_wolf_archive(headers.get(archive.source_path)!) === null)
        throw new Error("Unsupported WOLF archive header");
    } catch (cause) {
      throw new Error(
        archive.source_path + ": " + (cause instanceof Error ? cause.message : String(cause)),
        { cause },
      );
    }
  }
  return { root, data_root, archives, key_files };
}

/** 只固化原稿数据及配套描述，`Data/` 中的图片和音频仍由游戏提供。 */
export function collect_wolf_files(names: Iterable<string>): string[] {
  return [...names]
    .filter(
      (name) =>
        /^Data\/BasicData\/.*\.(?:dat|project)$/iu.test(name) || /^Data\/.*\.mps$/iu.test(name),
    )
    .sort();
}
