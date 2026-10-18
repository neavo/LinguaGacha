import path from "node:path";
import { GAME_FONT_EXTENSIONS } from "../../../../shared/game-font";
import type { NativeFs } from "../../../../native/native-fs";
import { ProjectAssetPathIndex } from "../../../../shared/project/project-asset-paths";
import { collect_rpgmaker_files } from "../../rpgmaker-mv-mz/source";
import { collect_rgss_files, script_path } from "../../rpgmaker-rgss/source";
import { collect_wolf_files } from "../../wolfrpg/source";
import {
  collect_existing_files,
  assert_game_path_spellings,
  assert_regular_path,
  validate_game_path,
} from "../../source-file-paths";
import type { GamePreparation } from "./prepare";
import type { SourceIdentity } from "../../source-discovery";

/** 一次操作读定的原字节，容器与备份共用数据集合。 */
export type GameSourceFiles = Readonly<{
  data: ReadonlyMap<string, Uint8Array>;
  fonts: ReadonlyMap<string, Uint8Array>;
}>;
export type GameSource = Extract<SourceIdentity, { kind: "mv_mz" | "rgss" | "wolfrpg" }>;

/** 读取准备后、修改前的集合，暂存路径只在本次目录事务内有效。 */
export function read_game_source_files(
  source: GameSource,
  fs: NativeFs,
  signal?: AbortSignal,
  prepared?: Readonly<{ staging: string; result: GamePreparation }>,
): GameSourceFiles {
  const root = source.game.root;
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
  const prefix =
    source.kind === "mv_mz" ? path.relative(root, source.game.data_root).replaceAll("\\", "/") : "";
  const local = (name: string) => [prefix, name].filter(Boolean).join("/");
  for (const name of source.kind === "mv_mz"
    ? [local("data"), local("js/plugins"), local("js/plugins.js"), local("fonts")]
    : source.kind === "rgss"
      ? ["Data", "Game.ini", "Fonts"]
      : ["Data", "Fonts"])
    collect(name);
  if (source.kind === "wolfrpg") {
    for (const entry of fs.read_dirents(root))
      if (GAME_FONT_EXTENSIONS.includes(path.extname(entry.name).slice(1).toLowerCase()))
        collect(entry.name);
  }
  if (prepared) {
    for (const name of [...prepared.result.writes, ...(prepared.result.removes ?? [])])
      validate_game_path(name);
    for (const name of prepared.result.writes) files.set(name, path.join(prepared.staging, name));
  }
  const data = new Map<string, Uint8Array>(); // RGSS 配置先读一次，用于确定外部脚本路径。
  /** 只读取最终选中的实际文件，读取前重新拒绝链接。 */
  function read(name: string): Uint8Array {
    signal?.throwIfAborted();
    const target = files.get(name);
    if (!target) throw new Error("Missing game source file: " + name);
    assert_regular_path(target, fs);
    return fs.read_file(target);
  }
  let data_names: string[];
  if (source.kind === "rgss") {
    const ini_name =
      [...files.keys()].find((name) => name.toLowerCase() === "game.ini") ?? "Game.ini";
    const ini = read(ini_name);
    data.set(ini_name, ini);
    const scripts = script_path(ini, source.game.version);
    if (!/^Data\//iu.test(scripts)) collect(scripts); // `Data/` 已完整收集，只需补收外部脚本。
    data_names = collect_rgss_files(source.game.version, files.keys(), scripts);
  } else
    data_names =
      source.kind === "mv_mz"
        ? collect_rpgmaker_files(source.game, files.keys())
        : collect_wolf_files(files.keys());
  const font_directory = local("fonts").toLowerCase() + "/";
  const font_names = [...files.keys()].filter(
    (name) =>
      name.toLowerCase().startsWith(font_directory) ||
      (source.kind === "wolfrpg" &&
        (/^Data\/Fonts\//iu.test(name) ||
          (!name.includes("/") &&
            GAME_FONT_EXTENSIONS.includes(path.extname(name).slice(1).toLowerCase())))),
  );
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
