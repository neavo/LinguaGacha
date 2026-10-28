import assert from "node:assert/strict";
import path from "node:path";
import type { NativeFs } from "../../../native/native-fs";
import { read_asar, read_asar_member, type AsarMember } from "../shared/asar";
import { resolve_game_source_input } from "../shared/game/source-input";
import {
  collect_game_source_files,
  type GameSourceData,
  type PreparedGameFiles,
} from "../shared/game/source-files";
import { sort_game_paths } from "../source-file-paths";
import { apply_config_overrides, read_tyrano_config, TYRANO_KEEP_SPACE } from "./config";
import { TYRANO_PARSERS, type SceneSyntax, type TyranoParser } from "./scene";

export const TYRANO_ARCHIVE = "resources/app.asar";
const ELECTRON_APP = "resources/app"; // 准备后游戏从该散装目录加载。
const PARSER_FILE = "tyrano/plugins/kag/kag.parser.js";
const CONFIG_FILE = "data/system/Config.tjs";
const ENTRY_FILE = "index.html"; // Electron 启动脚本加载的入口页面。
const LANGUAGE_DIRECTORY = "data/others/lang/"; // 引擎 `[lang_set]` 读取的语言表目录。
/** 已知语法族在解析器源码中的标识符。无法识别时拒绝，标识符相同的自定义修改不保证兼容。 */
const PARSER_MARKERS: Readonly<Record<TyranoParser, readonly string[]>> = {
  legacy: ["flag_quot_c", "cnt_quot_c", "num_kakko"],
  modern: ["start_quot", "end_char_of_param_value", "KeepSpaceInParameterValue"],
};

/** 识别结果，跨线程传给准备任务，只含可序列化的数据。 */
export type TyranoSource = Readonly<{
  root: string;
  app: string; // 应用根目录相对游戏根目录，空串表示游戏根目录本身。
  archive: string | null; // 准备时展开并退役的活动归档。
  syntax: SceneSyntax; // 识别时读定的解析语义，原样固化到格式元数据。
}>;
type Layout = Readonly<{ app: string; archive: ReadonlyMap<string, AsarMember> | null }>; // `archive` 为活动归档的成员索引。

/** 只按引擎标志识别布局，支持边界由 `discover_tyrano_source` 报告。 */
function read_layout(root: string, fs: NativeFs): Layout | null {
  const archive = path.join(root, TYRANO_ARCHIVE);
  if (fs.exists(archive) && fs.stat(archive).isFile()) {
    const members = read_asar(archive, fs);
    return members.has(PARSER_FILE) && members.has(CONFIG_FILE)
      ? { app: ELECTRON_APP, archive: members }
      : null;
  }
  const app = [ELECTRON_APP, ""].find(
    (app) =>
      fs.exists(path.join(root, app, PARSER_FILE)) && fs.exists(path.join(root, app, CONFIG_FILE)),
  );
  return app === undefined ? null : { app, archive: null };
}

/** 目录扫描据此停止递归，避免把引擎和场景文件当作普通来源。 */
export function is_tyrano_root(input: string, fs: NativeFs): boolean {
  const resolved = resolve_game_source_input(input, fs);
  return resolved !== null && read_layout(resolved.root, fs) !== null;
}

/** 识别后先检查支持边界，无法识别的解析器、载体冲突、待应用补丁和语言表都在准备前报告。 */
export async function discover_tyrano_source(
  input: string,
  fs: NativeFs,
): Promise<TyranoSource | null> {
  const resolved = resolve_game_source_input(input, fs);
  if (!resolved) return null;
  const { root } = resolved;
  const layout = read_layout(root, fs);
  if (!layout) return null;
  assert(
    !layout.archive || !fs.exists(path.join(root, ELECTRON_APP)),
    "TyranoScript game has both " +
      TYRANO_ARCHIVE +
      " and " +
      ELECTRON_APP +
      "; keep only the one the game uses",
  );
  const archive = path.join(root, TYRANO_ARCHIVE);
  const { syntax, base_config } = await read_tyrano_settings(async (name) => {
    if (!layout.archive) {
      const file = path.join(root, layout.app, name);
      return fs.exists(file) ? new TextDecoder().decode(fs.read_file(file)) : null;
    }
    const member = layout.archive.get(name);
    if (!member) return null;
    const handle = await fs.open_file(archive, "r");
    try {
      return new TextDecoder().decode(await read_asar_member(handle, archive, member, fs));
    } finally {
      await handle.close();
    }
  });
  // 引擎启动时按基础配置自动应用游戏目录中的同名补丁，准备后再应用会覆盖译文。
  assert(
    base_config.get("patch_apply_auto") === "false" ||
      !fs.exists(path.join(root, base_config.get("projectID") + ".tpatch")),
    "TyranoScript update patch is pending; start the original game once to apply it, then import again",
  );
  const languages = layout.archive
    ? [...layout.archive.keys()].some(
        (name) => name.startsWith(LANGUAGE_DIRECTORY) && name.endsWith(".json"),
      )
    : fs.exists(path.join(root, layout.app, LANGUAGE_DIRECTORY)) &&
      fs
        .read_dir_names(path.join(root, layout.app, LANGUAGE_DIRECTORY))
        .some((name) => name.toLowerCase().endsWith(".json"));
  // 语言表按原文索引场景，改写基础脚本会让切换语言静默失效。
  assert(!languages, "TyranoScript games with built-in language tables are not supported");
  return { root, app: layout.app, archive: layout.archive ? TYRANO_ARCHIVE : null, syntax };
}

/**
 * 按引擎启动顺序读取配置：Config.tjs 的基础配置先用于更新补丁检查，初始化时再叠加入口页面的静态覆盖。
 * 解析器版本取自引擎源码，参数空白规则取覆盖后的值。脚本运行时修改配置不在解释范围内。
 */
export async function read_tyrano_settings(
  read: (name: string) => Promise<string | null>,
): Promise<{ syntax: SceneSyntax; base_config: ReadonlyMap<string, string> }> {
  const source = (await read(PARSER_FILE)) ?? "";
  const parser = TYRANO_PARSERS.find((parser) =>
    PARSER_MARKERS[parser].every((marker) => source.includes(marker)),
  );
  assert(
    parser,
    "Unsupported TyranoScript parser; only known engine parser families are supported",
  );
  const base_config = read_tyrano_config((await read(CONFIG_FILE)) ?? "");
  const entry = await read(ENTRY_FILE);
  const config = entry === null ? base_config : apply_config_overrides(base_config, entry);
  return { syntax: { parser, keep_space: config.get(TYRANO_KEEP_SPACE) ?? "" }, base_config };
}

/** 应用目录内的相对路径。 */
export function tyrano_path(game: TyranoSource, name: string): string {
  return game.app ? game.app + "/" + name : name;
}

/** 翻译原稿按目录与类型收录 `data` 下的场景、游戏自有脚本和配置，不追踪任意加载路径。素材与引擎文件只进入清单。 */
export function collect_tyrano_files(
  game: TyranoSource,
  fs: NativeFs,
  signal?: AbortSignal,
  prepared?: PreparedGameFiles,
): GameSourceData {
  const data = tyrano_path(game, "data/").toLowerCase();
  const config = tyrano_path(game, CONFIG_FILE).toLowerCase();
  return collect_game_source_files(
    game.root,
    [tyrano_path(game, "data")],
    (files) =>
      sort_game_paths(
        [...files.keys()].filter((name) => {
          const lower = name.toLowerCase();
          return lower.startsWith(data) && (/\.(?:ks|js)$/u.test(lower) || lower === config);
        }),
      ),
    null,
    fs,
    signal,
    prepared,
  ).data;
}

/** 离线解析只依赖识别时读定的解析语义。 */
export function build_tyrano_metadata(game: TyranoSource): Uint8Array {
  return Buffer.from(JSON.stringify(game.syntax));
}
