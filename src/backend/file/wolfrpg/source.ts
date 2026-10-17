import path from "node:path";
import type { NativeFs } from "../../../native/native-fs";
import {
  assert_regular_path,
  collect_existing_files,
  GameSourceConflictError,
  validate_game_path,
} from "../source-file-paths";
import { read_bytes } from "../shared/binary";
import { WOLF_CRYPT_VERSIONS } from "./archive";

export type WolfSource = Readonly<{
  root: string;
  data_root: string;
  archives: readonly Readonly<{ source_path: string; output_prefix: string }>[];
}>;

/** 只使用布局标志确定游戏边界，坏游戏不能降级为普通目录。 */
export function wolf_source_root(source: string, fs: NativeFs): string | null {
  if (!fs.exists(source)) return null;
  const directory = fs.stat(source).isDirectory();
  if (!directory && path.extname(source).toLowerCase() !== ".exe") return null;
  const candidate = path.resolve(directory ? source : path.dirname(source));
  const roots =
    path.basename(candidate).toLowerCase() === "data"
      ? [candidate, path.dirname(candidate)]
      : [candidate];
  return (
    roots.find((root) =>
      ["Data.wolf", "Data/BasicData.wolf", "Data/BasicData/Game.dat"].some((name) =>
        fs.exists(path.join(root, name)),
      ),
    ) ?? null
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
    archives: Array<{ source_path: string; output_prefix: string }> = [];
  if (fs.exists(path.join(root, "Data.wolf")))
    archives.push({ source_path: path.join(root, "Data.wolf"), output_prefix: "Data" });
  if (fs.exists(data_root)) {
    assert_regular_path(data_root, fs);
    for (const entry of fs.read_dirents(data_root))
      if (entry.name.toLowerCase().endsWith(".wolf")) {
        if (!entry.isFile()) throw new Error("Invalid WOLF archive: " + entry.name);
        archives.push({
          source_path: path.join(data_root, entry.name),
          output_prefix: "Data/" + entry.name.slice(0, -5),
        });
      }
  }
  // 两种封装的相互优先级未确定，拒绝猜测同一数据根的有效来源。
  if (archives.some((archive) => archive.output_prefix === "Data") && archives.length > 1)
    throw new GameSourceConflictError("Conflicting WOLF data archives: " + root);
  for (const archive of archives) {
    signal?.throwIfAborted();
    assert_regular_path(archive.source_path, fs);
    const handle = await fs.open_file(archive.source_path, "r");
    try {
      const header = await read_bytes(handle, 0, 64),
        marker = header.readUInt32LE(44) >>> 16;
      if (
        header.readUInt16LE() !== 0x5844 ||
        header.readUInt16LE(2) !== 8 ||
        !WOLF_CRYPT_VERSIONS.includes(marker)
      )
        throw new Error(
          "Unsupported WOLF archive: " +
            archive.source_path +
            " header=" +
            header.subarray(0, 4).toString("hex") +
            " crypt=" +
            marker,
        );
    } finally {
      await handle.close();
    }
  }
  return {
    root,
    data_root,
    archives,
  };
}

/** 固化数据和配套描述，素材留在准备后的游戏目录。 */
export function collect_wolf_files(
  game: WolfSource,
  fs: NativeFs,
): Array<{ source_path: string; rel_path: string }> {
  const files = new Set<string>();
  collect_existing_files(game.root, "Data", files, fs);
  return [...files]
    .filter(
      (name) =>
        /^Data\/BasicData\/.*\.(?:dat|project)$/iu.test(name) || /^Data\/.*\.mps$/iu.test(name),
    )
    .sort()
    .map((rel_path) => {
      validate_game_path(rel_path);
      return { rel_path, source_path: path.join(game.root, rel_path) };
    });
}
