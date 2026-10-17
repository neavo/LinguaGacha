import { GameSourceConflictError } from "../source-file-paths";
import path from "node:path";
import type { NativeFs } from "../../../native/native-fs";
import { validate_zip_member_path } from "../shared/zip-members";
import { read_text } from "./value";
import type { GameFiles } from "../game/format";
import { read_rgss_archive_version } from "./archive";

export const RGSS_VERSIONS = { xp: ".rxdata", vx: ".rvdata", ace: ".rvdata2" } as const;
export type RGSSVersion = keyof typeof RGSS_VERSIONS;
export const RGSS_ARCHIVES = { xp: ".rgssad", vx: ".rgss2a", ace: ".rgss3a" } as const;
export type RGSSSource = {
  root: string;
  version: RGSSVersion;
  archive: string | null;
};
/** 发现只读取配置和归档头，错误由来源编排边界统一归集。 */
export function discover_rgss_source(source: string, fs: NativeFs): RGSSSource | null {
  if (!fs.exists(source)) return null;
  const root = fs.stat(source).isDirectory()
    ? path.resolve(source)
    : [".exe", ".ini", ...Object.values(RGSS_ARCHIVES)].includes(path.extname(source).toLowerCase())
      ? path.dirname(path.resolve(source))
      : null;
  if (root === null) return null;
  const versions = new Set(
    (Object.keys(RGSS_VERSIONS) as RGSSVersion[]).filter((version) =>
      fs.exists(path.join(root, "Data", "System" + RGSS_VERSIONS[version])),
    ),
  );
  const archives = fs
    .read_dirents(root)
    .filter(
      (entry) =>
        entry.isFile() &&
        Object.values(RGSS_ARCHIVES).some(
          (extension) => path.extname(entry.name).toLowerCase() === extension,
        ),
    );
  for (const entry of archives) {
    const version = (Object.keys(RGSS_ARCHIVES) as RGSSVersion[]).find(
      (value) => RGSS_ARCHIVES[value] === path.extname(entry.name).toLowerCase(),
    )!;
    versions.add(version);
  }
  const archive = archives[0]?.name ?? null;
  if (!fs.exists(path.join(root, "Game.ini")) && versions.size === 0) return null;
  {
    const content = fs.read_file(path.join(root, "Game.ini"));
    const ini = decode_ini(content);
    const scripts = read_ini_value(ini, "Scripts");
    const library = read_ini_value(ini, "Library");
    for (const version of Object.keys(RGSS_VERSIONS) as RGSSVersion[]) {
      if (
        scripts &&
        path.extname(scripts.replaceAll("\\", "/")).toLowerCase() === RGSS_VERSIONS[version]
      )
        versions.add(version);
    }
    const generation = /(?:^|[\\/])RGSS([123])\d*[^\\/]*\.dll$/iu.exec(library ?? "")?.[1];
    if (generation) versions.add(generation === "1" ? "xp" : generation === "2" ? "vx" : "ace");
    const version = [...versions][0];
    if (!version) return null;
    if (archives.length > 1) throw new GameSourceConflictError("Conflicting RGSS archive entries");
    if (versions.size !== 1) throw new Error("Conflicting RGSS engine versions");
    script_path(content, version);
    if (archive) {
      const protocol = read_rgss_archive_version(fs.read_prefix(path.join(root, archive), 8));
      if (protocol !== (version === "ace" ? 3 : 1))
        throw new Error("RGSS archive protocol does not match the engine");
    }
  }
  const version = [...versions][0]!;
  return { root, version, archive };
}
/** Game.ini 常见 ANSI 编码只用于读取配置，原始字节始终保留。 */
function decode_ini(content: Uint8Array): string {
  try {
    return read_text(content);
  } catch {
    return read_text(content, "cp932");
  }
}
/** 仅消费 [Game] 配置，忽略其他节的同名字段。 */
function read_ini_value(ini: string, key: string): string | null {
  let game = false;
  for (const line of ini.split(/\r?\n/u)) {
    const section = /^\s*\[([^\]]+)\]/u.exec(line);
    if (section) {
      game = section[1]!.toLowerCase() === "game";
      continue;
    }
    const entry = game ? /^\s*([^=]+?)\s*=\s*(.*?)\s*$/u.exec(line) : null;
    if (entry?.[1]?.toLowerCase() === key.toLowerCase()) return entry[2]!.replace(/^"|"$/gu, "");
  }
  return null;
}
/** 配置脚本路径必须留在游戏目录内，并匹配引擎的数据版本。 */
export function script_path(content: Uint8Array, version: RGSSVersion): string {
  const configured = read_ini_value(decode_ini(content), "Scripts");
  if (configured) {
    const name = validate_zip_member_path(configured.replaceAll("\\", "/"));
    if (path.extname(name).toLowerCase() !== RGSS_VERSIONS[version])
      throw new Error("Inconsistent RGSS script version");
    return name;
  }
  return "Data/Scripts" + RGSS_VERSIONS[version];
}
/** 固化数据和配置指定的脚本，使工程脱离游戏目录后仍能导出。 */
export function collect_rgss_files(game: RGSSSource, fs: NativeFs) {
  const { root, version } = game;
  const names = new Set<string>(["Game.ini"]);
  const scripts = script_path(fs.read_file(path.join(root, "Game.ini")), version);
  // 仅沿数据目录收集本代文件，素材继续由原游戏提供。
  function collect(directory: string): void {
    for (const entry of fs
      .read_dirents(path.join(root, directory))
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const name = directory + "/" + entry.name;
      if (entry.isDirectory()) collect(name);
      else if (entry.isFile() && path.extname(name).toLowerCase() === RGSS_VERSIONS[version])
        names.add(name);
    }
  }
  collect("Data");
  // 配置大小写可能与磁盘不同，同一脚本仅保存实际数据清单中的一份。
  if (![...names].some((name) => name.toLowerCase() === scripts.toLowerCase())) names.add(scripts);
  return [...names].map((rel_path) => ({ rel_path, source_path: path.join(root, rel_path) }));
}
/** 导出以固化原稿确认版本，配置与数据扩展名必须一致。 */
export async function read_rgss_game(
  files: GameFiles,
): Promise<{ version: RGSSVersion; scripts: string }> {
  const versions = (Object.keys(RGSS_VERSIONS) as RGSSVersion[]).filter((version) =>
    [...files.keys()].some((name) => name.toLowerCase() === "data/system" + RGSS_VERSIONS[version]),
  );
  if (versions.length !== 1) throw new Error("Ambiguous RGSS version");
  const version = versions[0]!;
  const ini = [...files].find(([name]) => name.toLowerCase() === "game.ini")?.[1];
  if (!ini) throw new Error("Missing Game.ini");
  const scripts = script_path(await ini.async("uint8array"), version);
  if (
    [...files.keys()].some(
      (name) =>
        /\.(?:rxdata|rvdata2?)$/iu.test(name) &&
        path.extname(name).toLowerCase() !== RGSS_VERSIONS[version],
    )
  )
    throw new Error("Mixed RGSS versions");
  return { version, scripts };
}
