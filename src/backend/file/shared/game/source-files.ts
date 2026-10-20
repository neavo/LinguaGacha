import path from "node:path";
import type { NativeFs } from "../../../../native/native-fs";
import { ProjectAssetPathIndex } from "../../../../shared/project/project-asset-paths";
import {
  collect_existing_files,
  assert_game_path_spellings,
  assert_regular_path,
  validate_game_path,
} from "../../source-file-paths";
import type { GamePreparation } from "./prepare";
import { GAME_ENGINES, type GameSource } from "./engines";
export type { GameSource } from "./engines";

/** 一次操作读定的原字节，容器与备份共用数据集合。 */
export type GameSourceFiles = Readonly<{
  data: ReadonlyMap<string, Uint8Array>;
  fonts: ReadonlyMap<string, Uint8Array>;
}>;
export type PreparedGameFiles = Readonly<{ staging: string; result: GamePreparation }>;

/** 读取准备后、修改前的集合，暂存路径只在本次目录事务内有效。 */
export function read_game_source_files(
  source: GameSource,
  fs: NativeFs,
  signal?: AbortSignal,
  prepared?: PreparedGameFiles,
): GameSourceFiles {
  return GAME_ENGINES[source.file_type].collect(source, fs, signal, prepared);
}

/** 引擎声明收集入口和选择器，公共层持有路径检查、暂存覆盖和原字节读取。 */
export function collect_game_source_files(
  root: string,
  roots: readonly string[],
  select: (
    files: ReadonlyMap<string, string>,
    read: (name: string) => Uint8Array,
    collect: (name: string) => void,
  ) => string[],
  is_font: (name: string) => boolean,
  fs: NativeFs,
  signal?: AbortSignal,
  prepared?: PreparedGameFiles,
): GameSourceFiles {
  const files = new Map<string, string>(); // 相对路径指向正式文件或本轮暂存文件。
  const removed = new Set(prepared?.result.removes ?? []); // 移除清单只过滤正式文件，暂存写入仍优先。
  /** 按目录项解析预期入口并保留实际大小写，缺失目录自然跳过。 */
  function collect(expected: string): void {
    signal?.throwIfAborted();
    let candidates = [""];
    for (const part of expected.split("/")) {
      candidates = candidates.flatMap((parent) => {
        const directory = path.join(root, parent);
        assert_regular_path(directory, fs);
        if (!fs.stat(directory).isDirectory()) return [];
        return fs
          .read_dirents(directory)
          .filter((entry) => entry.name.toLowerCase() === part.toLowerCase())
          .map((entry) => [parent, entry.name].filter(Boolean).join("/"));
      });
    }
    const existing = new Set<string>();
    for (const name of candidates) collect_existing_files(root, name, existing, fs, signal);
    // 外部脚本补收可能与暂存文件同名，保留已选定的暂存来源。
    for (const name of existing)
      if (!removed.has(name) && !files.has(name)) files.set(name, path.join(root, name));
  }
  for (const name of roots) collect(name);
  if (prepared) {
    for (const name of [...prepared.result.writes, ...(prepared.result.removes ?? [])])
      validate_game_path(name);
    for (const name of prepared.result.writes) files.set(name, path.join(prepared.staging, name));
  }
  const data = new Map<string, Uint8Array>();
  const captured = new Map<string, Uint8Array>(); // 选择器先读取的 RGSS 配置与最终原稿共用同一份字节。
  /** 只读取最终选中的实际文件，读取前重新拒绝链接。 */
  function read(name: string): Uint8Array {
    signal?.throwIfAborted();
    const existing = captured.get(name);
    if (existing) return existing;
    const target = files.get(name);
    if (!target) throw new Error("Missing game source file: " + name);
    assert_regular_path(target, fs);
    const bytes = fs.read_file(target);
    captured.set(name, bytes);
    return bytes;
  }
  const data_names = select(files, read, collect);
  const font_names = [...files.keys()].filter(is_font);
  const names = [...new Set([...data_names, ...font_names])];
  assert_game_path_spellings(names);
  const index = new ProjectAssetPathIndex();
  for (const name of names) {
    validate_game_path(name);
    index.add(name);
  }
  for (const name of data_names) if (!data.has(name)) data.set(name, read(name));
  const fonts = new Map(font_names.sort().map((name) => [name, data.get(name) ?? read(name)]));
  signal?.throwIfAborted();
  return { data, fonts };
}
