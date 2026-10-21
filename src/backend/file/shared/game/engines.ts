import path from "node:path";
import {
  discover_godot_source,
  is_godot_root,
  collect_godot_files,
  type GodotSource,
} from "../../godot/source";
import { stage_godot_source } from "../../godot/prepare";
import { create_godot_adapter } from "../../godot/godot-format";
import { read_godot_metadata, godot_default_status } from "../../godot/item";
import type { NativeFs } from "../../../../native/native-fs";
import type { Item, ItemStatus } from "../../../../domain/item";
import { is_json_record } from "../../../../domain/json";
import { GAME_FONT_EXTENSIONS } from "../../../../shared/game-font";
import type { GameFileType } from "../../../../shared/project-source-formats";
import type { FileFormatServiceConfig } from "../../file-format-types";
import type { GameFiles, GameFormatAdapter } from "./format";
import {
  collect_game_source_files,
  type GameSourceFiles,
  type PreparedGameFiles,
} from "./source-files";
import { prepare_game_directory, type GamePreparation } from "./prepare";
import type { GamePrepareExecution } from "./prepare-worker";
import {
  discover_wolf_source,
  wolf_source_root,
  collect_wolf_files,
  type WolfSource,
} from "../../wolfrpg/source";
import { stage_wolf_source } from "../../wolfrpg/prepare";
import { create_wolf_adapter } from "../../wolfrpg/wolf-format";
import { read_wolf_metadata, wolf_default_status } from "../../wolfrpg/item";
import { read_wolf_sources } from "../../wolfrpg/readable";
import {
  discover_rpgmaker_source,
  discover_unpacked_rpgmaker_source,
  collect_rpgmaker_files,
  type RPGMakerSource,
} from "../../rpgmaker-mv-mz/source";
import { stage_rpgmaker_source } from "../../rpgmaker-mv-mz/prepare";
import { create_rpgmaker_mv_mz_adapter } from "../../rpgmaker-mv-mz/rpgmaker-format";
import { read_rpgmaker_metadata, rpgmaker_default_status } from "../../rpgmaker-mv-mz/item";
import {
  discover_rgss_source,
  collect_rgss_files,
  script_path,
  type RGSSSource,
} from "../../rpgmaker-rgss/source";
import { stage_rgss_source } from "../../rpgmaker-rgss/prepare";
import { create_rpgmaker_rgss_adapter } from "../../rpgmaker-rgss/rpgmaker-format";
import { read_rgss_metadata, rgss_default_status } from "../../rpgmaker-rgss/item";
import { read_rgss_sources } from "../../rpgmaker-rgss/readable";
import type { GameFont } from "./font-replace";
import { wolf_font_outputs } from "../../wolfrpg/font";
import { mv_mz_font_outputs } from "../../rpgmaker-mv-mz/font";
import { godot_font_outputs } from "../../godot/font";
import { read_godot_sources } from "../../godot/readable";

type GameSources = {
  GODOT: GodotSource;
  WOLFRPG: WolfSource;
  RPGMAKER_MV_MZ: RPGMakerSource;
  RPGMAKER_RGSS: RGSSSource;
};
export type GameSource = {
  [K in GameFileType]: Readonly<{ kind: "game"; file_type: K; game: GameSources[K] }>;
}[GameFileType];

/** 登记顺序决定发现优先级。引擎只声明格式行为，正式目录写入归共享事务持有。 */
interface EngineDefinition<G> {
  discover(input: string, fs: NativeFs, signal?: AbortSignal): G | null | Promise<G | null>;
  is_root(input: string, fs: NativeFs): unknown;
  source_path(game: G, input: string): string;
  identity(game: G): string;
  needs_stage(game: G, fs: NativeFs): boolean;
  stage(
    task: Readonly<{ game: G; staging: string }>,
    fs: NativeFs,
    signal?: AbortSignal,
  ): Promise<GamePreparation>;
  collect(
    game: G,
    fs: NativeFs,
    signal?: AbortSignal,
    prepared?: PreparedGameFiles,
  ): GameSourceFiles;
  create_adapter(config: FileFormatServiceConfig): GameFormatAdapter;
  read_metadata(extra: Item["extra_field"]): { internal_file_path: string };
  default_status(item: Pick<Item, "extra_field">): ItemStatus;
  workspace_view?(members: GameFiles): AsyncIterable<readonly [string, Uint8Array]>;
  font_outputs?(game: G, files: GameSourceFiles, font: GameFont): ReadonlyMap<string, Uint8Array>;
}
export type GameEngine = Omit<EngineDefinition<GameSource>, "discover" | "stage"> & {
  discover(input: string, fs: NativeFs, signal?: AbortSignal): Promise<GameSource | null>;
  stage(
    task: GameSource & { staging: string },
    fs: NativeFs,
    signal?: AbortSignal,
  ): Promise<GamePreparation>;
};

/** 在登记边界保留 file_type 与载荷的对应关系，分发后只由对应引擎消费。 */
function register<K extends GameFileType>(
  file_type: K,
  engine: EngineDefinition<GameSources[K]>,
): GameEngine {
  const game = (source: GameSource): GameSources[K] => {
    if (source.file_type !== file_type)
      throw new Error("Mismatched game engine: " + source.file_type);
    return source.game as GameSources[K];
  };
  const { font_outputs, ...definition } = engine;
  return {
    ...definition,
    // 能力缺省表示不支持字体修改，准入与执行共用同一声明。
    ...(font_outputs && {
      font_outputs: (source: GameSource, files: GameSourceFiles, font: GameFont) =>
        font_outputs(game(source), files, font),
    }),
    async discover(input, fs, signal) {
      const found = await engine.discover(input, fs, signal);
      return found ? ({ kind: "game", file_type, game: found } as GameSource) : null;
    },
    source_path: (source, input) => engine.source_path(game(source), input),
    identity: (source) => engine.identity(game(source)),
    needs_stage: (source, fs) => engine.needs_stage(game(source), fs),
    stage: (task, fs, signal) =>
      engine.stage({ game: game(task), staging: task.staging }, fs, signal),
    collect: (source, fs, signal, prepared) => engine.collect(game(source), fs, signal, prepared),
  };
}

export const GAME_ENGINES: Record<GameFileType, GameEngine> = {
  WOLFRPG: register("WOLFRPG", {
    discover: discover_wolf_source,
    is_root: wolf_source_root,
    source_path: (game) => game.root,
    identity: (game) => game.root,
    needs_stage: () => true,
    stage: stage_wolf_source,
    collect: (game, fs, signal, prepared) =>
      collect_game_source_files(
        game.root,
        [
          "Data",
          "Fonts",
          ...fs
            .read_dirents(game.root)
            .filter((entry) =>
              GAME_FONT_EXTENSIONS.includes(path.extname(entry.name).slice(1).toLowerCase()),
            )
            .map((entry) => entry.name),
        ],
        (files) => collect_wolf_files(files.keys()),
        (name) =>
          /^Fonts\//iu.test(name) ||
          /^Data\/Fonts\//iu.test(name) ||
          (!name.includes("/") &&
            GAME_FONT_EXTENSIONS.includes(path.extname(name).slice(1).toLowerCase())),
        fs,
        signal,
        prepared,
      ),
    create_adapter: create_wolf_adapter,
    read_metadata: read_wolf_metadata,
    default_status: wolf_default_status,
    workspace_view: read_wolf_sources,
    font_outputs: (_game, files, font) => wolf_font_outputs(files.data, files.fonts, font),
  }),
  RPGMAKER_MV_MZ: register("RPGMAKER_MV_MZ", {
    discover: discover_rpgmaker_source,
    is_root: discover_unpacked_rpgmaker_source,
    source_path: (game, input) => game.executable ?? input,
    identity: (game) => game.executable ?? game.root,
    needs_stage: (game, fs) => {
      if (game.executable) return true;
      const system: unknown = JSON.parse(
        new TextDecoder().decode(fs.read_file(path.join(game.data_root, "data/System.json"))),
      );
      if (!is_json_record(system)) throw new Error("Invalid MV/MZ System.json");
      return Boolean(system["hasEncryptedImages"] || system["hasEncryptedAudio"]);
    },
    stage: stage_rpgmaker_source,
    collect: (game, fs, signal, prepared) => {
      const prefix = path.relative(game.root, game.data_root).replaceAll("\\", "/");
      const local = (name: string) => [prefix, name].filter(Boolean).join("/");
      return collect_game_source_files(
        game.root,
        ["data", "js/plugins", "js/plugins.js", "fonts"].map(local),
        (files) => collect_rpgmaker_files(game, files.keys()),
        (name) => name.toLowerCase().startsWith(local("fonts").toLowerCase() + "/"),
        fs,
        signal,
        prepared,
      );
    },
    create_adapter: create_rpgmaker_mv_mz_adapter,
    read_metadata: read_rpgmaker_metadata,
    default_status: rpgmaker_default_status,
    font_outputs: (game, files, font) => mv_mz_font_outputs(game, files.fonts, font),
  }),
  RPGMAKER_RGSS: register("RPGMAKER_RGSS", {
    discover: discover_rgss_source,
    is_root: discover_rgss_source,
    source_path: (game) => game.root,
    identity: (game) => path.join(game.root, game.archive ?? ""),
    needs_stage: (game) => Boolean(game.archive),
    stage: stage_rgss_source,
    collect: (game, fs, signal, prepared) =>
      collect_game_source_files(
        game.root,
        ["Data", "Game.ini", "Fonts"],
        (files, read, collect) => {
          const ini =
            [...files.keys()].find((name) => name.toLowerCase() === "game.ini") ?? "Game.ini";
          const scripts = script_path(read(ini), game.version);
          if (!/^Data\//iu.test(scripts)) collect(scripts);
          return collect_rgss_files(game.version, files.keys(), scripts);
        },
        (name) => /^Fonts\//iu.test(name),
        fs,
        signal,
        prepared,
      ),
    create_adapter: create_rpgmaker_rgss_adapter,
    read_metadata: read_rgss_metadata,
    default_status: rgss_default_status,
    workspace_view: read_rgss_sources,
  }),
  GODOT: register("GODOT", {
    discover: discover_godot_source,
    is_root: is_godot_root,
    source_path: (game, input) => (path.resolve(input) === game.root ? game.root : game.executable),
    identity: (game) => game.executable,
    needs_stage: (game) => game.embedded !== null || game.external.length > 0,
    stage: stage_godot_source,
    collect: collect_godot_files,
    create_adapter: create_godot_adapter,
    read_metadata: read_godot_metadata,
    default_status: godot_default_status,
    workspace_view: read_godot_sources,
    font_outputs: (_game, files, font) => godot_font_outputs(files.data, files.fonts, font.bytes),
  }),
};

/** 来源准备只在这里选择是否暂存，worker 返回后由同一个事务提交。 */
export async function prepare_game_source(
  source: GameSource,
  fs: NativeFs,
  execute?: GamePrepareExecution,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  if (!GAME_ENGINES[source.file_type].needs_stage(source, fs)) return;
  await prepare_game_directory(
    source.game.root,
    fs,
    (staging) => {
      const task = { ...source, staging };
      return execute
        ? execute(task, signal)
        : GAME_ENGINES[source.file_type].stage(task, fs, signal);
    },
    signal,
  );
}
