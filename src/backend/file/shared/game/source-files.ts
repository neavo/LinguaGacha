import path from "node:path";
import type { NativeFs } from "../../../../native/native-fs";
import { ProjectAssetPathIndex } from "../../../../shared/project/project-asset-paths";
import {
  collect_existing_files,
  assert_game_path_spellings,
  assert_regular_path,
  validate_game_path,
  is_preparation_path,
} from "../../source-file-paths";
import {
  source_diagnostic,
  type PreparedGameFiles as PreparedSources,
  type SourceDiagnostic,
} from "./preparation";
import type { GameReadResult } from "./format";
/** 读取诊断回调只在主线程使用，Worker 回包仍只携带来源数据。 */
export type PreparedGameFiles = PreparedSources &
  Readonly<{ on_read_failure?: (diagnostic: SourceDiagnostic) => void }>;

/** 一次操作读定的原字节，按相对路径索引。 */
export type GameSourceData = ReadonlyMap<string, Uint8Array>;
/** 字体工具读定的原字节：数据承载字体配置，字体为替换目标。 */
export type GameSourceFiles = Readonly<{ data: GameSourceData; fonts: GameSourceData }>;
/** 本次导入已读定的快照，格式导入语义只消费它，不重新扫描活动游戏目录。 */
export type GameImportSources = Readonly<{
  data: GameSourceData; // 翻译原稿与附加原稿，即将固化的同一份字节。
  files: readonly string[]; // 完整有效文件清单。
  complete: boolean; // 翻译原稿是否完整，附加原稿的遗漏不改变格式的跨成员语义。
}>;
/** 格式导入的结果：固化的格式元数据，以及本次已完成的成员读取结果。 */
export type GameImport = Readonly<{ metadata: Uint8Array; read?: readonly GameReadResult[] }>;

const ADDITIONAL_EXTENSIONS = new Set([".txt", ".json", ".csv", ".tsv", ".ks"]); // `.ks` 仅固化原稿，文本提取由独立格式能力提供。

/** 完整清单与附加原稿共用一次遍历。翻译成员由引擎收集，`includes` 只限定附加原稿的扫描范围。 */
export function collect_game_import_files(
  root: string,
  translation: GameSourceData,
  includes: (name: string) => boolean,
  fs: NativeFs,
  signal?: AbortSignal,
  prepared?: PreparedGameFiles,
): { data: GameSourceData; additional_files: string[]; files: string[] } {
  const data = new Map(translation); // 保留引擎已读定的字节，附加原稿只补充其他成员。
  const additional_files: string[] = [];
  const names = new Set<string>(); // 完整清单也包含不收录字节的素材。
  /** 清单覆盖整个游戏，扫描范围只限制附加原稿的字节读取。 */
  const visit = (relative: string): void => {
    signal?.throwIfAborted();
    assert_regular_path(path.join(root, relative), fs);
    for (const entry of fs
      .read_dirents(path.join(root, relative))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      signal?.throwIfAborted();
      const name = relative === "" ? entry.name : relative + "/" + entry.name;
      if (is_preparation_path(name)) continue;
      if (entry.isDirectory()) visit(name);
      else if (entry.isFile()) {
        if (!/[\r\n]/u.test(name)) names.add(name); // 行格式不能表示含换行的名称。
        if (
          translation.has(name) ||
          !includes(name) ||
          !ADDITIONAL_EXTENSIONS.has(path.extname(name).toLowerCase())
        )
          continue;
        validate_game_path(name);
        const target = path.join(root, name);
        assert_regular_path(target, fs);
        if (!prepared?.files.has(name) && !prepared?.excluded.includes(name)) {
          try {
            data.set(name, fs.read_file(target));
            additional_files.push(name);
          } catch (error) {
            if (!prepared?.on_read_failure) throw error;
            prepared.on_read_failure(source_diagnostic("read", error, name));
          }
        }
      }
    }
  };
  visit("");
  for (const [name, target] of prepared?.files ?? []) {
    if (!/[\r\n]/u.test(name)) names.add(name);
    if (
      translation.has(name) ||
      !includes(name) ||
      !ADDITIONAL_EXTENSIONS.has(path.extname(name).toLowerCase())
    )
      continue;
    if (target === null) {
      const diagnostic = source_diagnostic(
        "read",
        new Error("Selected original is unavailable"),
        name,
      );
      if (!prepared?.on_read_failure) throw new Error(diagnostic.error.message);
      prepared.on_read_failure(diagnostic);
      continue;
    }
    validate_game_path(name);
    try {
      assert_regular_path(target, fs);
      data.set(name, fs.read_file(target));
      additional_files.push(name);
    } catch (error) {
      if (!prepared?.on_read_failure) throw error;
      prepared.on_read_failure(source_diagnostic("read", error, name));
    }
  }
  signal?.throwIfAborted();
  return {
    data,
    additional_files: additional_files.sort(),
    files: [...names].filter((name) => !prepared?.excluded.includes(name)).sort(),
  };
}

/** 引擎声明收集入口和选择器，公共层持有路径检查、暂存覆盖和原字节读取。 */
export function collect_game_source_files(
  root: string,
  roots: readonly string[],
  select: (
    files: ReadonlyMap<string, string | null>,
    read: (name: string) => Uint8Array,
    collect: (name: string) => void,
  ) => string[],
  is_font: ((name: string, read: (name: string) => Uint8Array) => boolean) | null, // null 表示不收集字体。
  fs: NativeFs,
  signal?: AbortSignal,
  prepared?: PreparedGameFiles,
): GameSourceFiles {
  const files = new Map<string, string | null>(); // null 保留失败来源的身份，选择器仍能报告该成员。
  const removed = new Set(prepared?.excluded ?? []);
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
      if (!removed.has(name) && !files.has(name) && !prepared?.files.has(name))
        files.set(name, path.join(root, name));
  }
  for (const name of roots) collect(name);
  if (prepared) {
    for (const [name, target] of prepared.files) {
      validate_game_path(name);
      files.set(name, target);
    }
  }
  const data = new Map<string, Uint8Array>();
  const captured = new Map<string, Uint8Array>(); // 选择器先读取的 RGSS 配置与最终原稿共用同一份字节。
  const verified = new Set<string>(); // 本次读取阶段只读，共同祖先只核对一次。
  /** 只读取最终选中的实际文件，读取前重新拒绝链接。 */
  function read(name: string): Uint8Array {
    signal?.throwIfAborted();
    const existing = captured.get(name);
    if (existing) return existing;
    const target = files.get(name);
    if (target === null) throw new Error("Selected game source is unavailable: " + name);
    if (!target) throw new Error("Missing game source file: " + name);
    assert_regular_path(target, fs, verified);
    const bytes = fs.read_file(target);
    captured.set(name, bytes);
    return bytes;
  }
  const data_names = select(files, read, collect);
  const font_names = is_font ? [...files.keys()].filter((name) => is_font(name, read)) : [];
  const names = [...new Set([...data_names, ...font_names])];
  assert_game_path_spellings(names);
  const index = new ProjectAssetPathIndex();
  for (const name of names) {
    validate_game_path(name);
    index.add(name);
  }
  for (const name of data_names)
    if (!data.has(name)) {
      try {
        data.set(name, read(name));
      } catch (error) {
        signal?.throwIfAborted();
        if (!prepared?.on_read_failure) throw error;
        prepared.on_read_failure(source_diagnostic("read", error, name));
      }
    }
  const fonts = new Map(font_names.sort().map((name) => [name, read(name)]));
  signal?.throwIfAborted();
  return { data, fonts };
}
