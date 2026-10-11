import path from "node:path";
import type { NativeFs } from "../../../native/native-fs";
import { validate_zip_member_path } from "../zip-members";
import { read_text } from "./value";
import type { GameFiles } from "../rpgmaker-shared";

export const RGSS_VERSIONS = { xp: ".rxdata", vx: ".rvdata", ace: ".rvdata2" } as const;
export type RGSSVersion = keyof typeof RGSS_VERSIONS;
type RGSSSource = { root: string; version: RGSSVersion };
/** 数据扩展名与 Game.ini 共同确定已解包游戏身份。 */
export function discover_rgss_source(source: string, fs: NativeFs): RGSSSource | null {
  if (!fs.exists(source)) return null;
  const root = fs.stat(source).isDirectory()
    ? path.resolve(source)
    : [".exe", ".ini"].includes(path.extname(source).toLowerCase())
      ? path.dirname(path.resolve(source))
      : null;
  if (root === null || !fs.exists(path.join(root, "Game.ini"))) return null;
  const versions = (Object.keys(RGSS_VERSIONS) as RGSSVersion[]).filter((version) =>
    fs.exists(path.join(root, "Data", "System" + RGSS_VERSIONS[version])),
  );
  return versions.length === 1 ? { root, version: versions[0]! } : null;
}
/** Game.ini 常见 ANSI 编码只用于读取配置，原始字节始终保留。 */
export function script_path(content: Uint8Array, version: RGSSVersion): string {
  let ini: string;
  try {
    ini = read_text(content);
  } catch {
    ini = read_text(content, "cp932");
  }
  let game = false;
  for (const line of ini.split(/\r?\n/u)) {
    const section = /^\s*\[([^\]]+)\]/u.exec(line);
    if (section) {
      game = section[1]!.toLowerCase() === "game";
      continue;
    }
    const entry = game ? /^\s*Scripts\s*=\s*(.*?)\s*$/iu.exec(line) : null;
    if (entry) {
      const name = validate_zip_member_path(entry[1]!.replace(/^"|"$/gu, "").replaceAll("\\", "/"));
      if (path.extname(name).toLowerCase() !== RGSS_VERSIONS[version])
        throw new Error("Inconsistent RGSS script version");
      return name;
    }
  }
  return "Data/Scripts" + RGSS_VERSIONS[version];
}
/** 固化数据和配置指定的脚本，使工程脱离游戏目录后仍能导出。 */
export function collect_rgss_files(source: string, fs: NativeFs) {
  const game = discover_rgss_source(source, fs);
  if (!game) return null;
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
