import { GameSourceConflictError, sort_game_paths } from "../source-file-paths";
import { read_evb, type EVBMember } from "../shared/evb/archive";
import path from "node:path";
import type { NativeFs } from "../../../native/native-fs";
import { resolve_game_source_input } from "../shared/game/source-input";

export type RPGMakerSource = Readonly<{
  root: string;
  data_root: string;
  executable?: string; // 仅记录需展开的封装入口，散装启动器保留在来源路径。
  engine: "mv" | "mz";
}>; // 游戏身份与可能位于 `www` 的运行数据分开定位。

/** 游戏标志文件约束发现范围，普通 JSON 仍走通用格式入口。 */
export function discover_unpacked_rpgmaker_source(
  source: string,
  fs: NativeFs,
): RPGMakerSource | null {
  const input = resolve_game_source_input(source, fs);
  if (!input) return null;
  const { root } = input;
  const data_root = find_data_root(root, fs);
  if (data_root === undefined) return null;
  return {
    root,
    data_root,
    engine: fs.exists(path.join(data_root, "js/rmmz_core.js")) ? "mz" : "mv",
  };
}

/** 数据选择只解释准备后的相对路径，目录遍历由共享收集入口负责。 */
export function collect_rpgmaker_files(
  { root, data_root }: RPGMakerSource,
  names: Iterable<string>,
): string[] {
  const prefix = path.relative(root, data_root).replaceAll("\\", "/").toLowerCase();
  const files = [...names].filter((name) => !prefix || name.toLowerCase().startsWith(prefix + "/"));
  const local = (name: string) => (prefix ? name.slice(prefix.length + 1) : name);
  return [
    ...sort_game_paths(files.filter((name) => /^data\/.*\.json$/iu.test(local(name)))),
    ...files.filter((name) => local(name).toLowerCase() === "js/plugins.js"),
    ...sort_game_paths(files.filter((name) => /^js\/plugins\/.*\.js$/iu.test(local(name)))),
  ];
}

/** MV 打包可能把运行数据放在 `www`，标志文件共同确认游戏根目录。 */
function find_data_root(root: string, fs: NativeFs): string | undefined {
  return [root, path.join(root, "www")].find(
    (candidate) =>
      fs.exists(path.join(candidate, "data", "System.json")) &&
      (fs.exists(path.join(candidate, "js", "rpg_core.js")) ||
        fs.exists(path.join(candidate, "js", "rmmz_core.js"))),
  );
}

/** 保留所选 EXE 身份，目录内多个封装入口必须由用户明确选择。 */
export async function discover_rpgmaker_source(
  source: string,
  fs: NativeFs,
  signal?: AbortSignal,
): Promise<RPGMakerSource | null> {
  const input = resolve_game_source_input(source, fs);
  if (!input) return null;
  const { root } = input;
  const executables = input.executable
    ? [input.executable]
    : fs
        .read_dirents(root)
        .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".exe")
        .map((entry) => path.join(root, entry.name));
  const games: RPGMakerSource[] = [];
  for (const executable of executables) {
    signal?.throwIfAborted();
    const handle = await fs.open_file(executable, "r");
    try {
      const archive = await read_evb(handle, signal);
      if (!archive) continue;
      const game = read_evb_game(root, executable, archive.members);
      if (game) games.push(game);
    } finally {
      await handle.close();
    }
  }
  if (games.length > 1)
    throw new GameSourceConflictError("Multiple EVB game launchers; select one EXE: " + root);
  return games[0] ?? discover_unpacked_rpgmaker_source(source, fs);
}

/** 来源探测与 worker 复核解释同一清单，不为游戏识别重新读取归档。 */
export function read_evb_game(
  root: string,
  executable: string,
  members: readonly EVBMember[],
): RPGMakerSource | null {
  const names = new Set(members.map((member) => member.name));
  const prefix = ["", "www/"].find(
    (prefix) =>
      names.has(prefix + "data/System.json") &&
      (names.has(prefix + "js/rpg_core.js") || names.has(prefix + "js/rmmz_core.js")),
  );
  return prefix === undefined
    ? null
    : {
        root,
        data_root: path.join(root, prefix),
        executable,
        engine: names.has(prefix + "js/rmmz_core.js") ? "mz" : "mv",
      };
}
