import path from "node:path";
import {
  discover_renpy_source,
  is_renpy_root,
  collect_renpy_files,
  collect_renpy_fonts,
  prepare_renpy_import,
  type RenpySource,
} from "../../renpy/source";
import { renpy_font_outputs } from "../../renpy/font";
import { stage_renpy_source } from "../../renpy/prepare";
import { create_renpy_adapter } from "../../renpy/renpy-format";
import { read_renpy_metadata, renpy_default_status } from "../../renpy/item";
import { read_renpy_projections } from "../../renpy/readable";
import {
  discover_godot_source,
  is_godot_root,
  collect_godot_files,
  collect_godot_fonts,
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
import type { GameFiles, GameFormatAdapter } from "./format";
import type { ReadableFile, ProjectionFailure } from "./readable";
import {
  collect_game_source_files,
  type GameImport,
  type GameImportSources,
  type GameSourceData,
  type GameSourceFiles,
  type PreparedGameFiles,
} from "./source-files";
import { write_game_directory, type GameDirectoryCleanupReporter } from "./directory";
import {
  complete_game_preparation,
  source_diagnostic,
  type GamePreparation,
  type SourceDiagnostic,
} from "./preparation";
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
import { read_wolf_projections } from "../../wolfrpg/readable";
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
import { read_rgss_projections } from "../../rpgmaker-rgss/readable";
import type { GameFont } from "./font-replace";
import { wolf_font_outputs } from "../../wolfrpg/font";
import { mv_mz_font_outputs } from "../../rpgmaker-mv-mz/font";
import { godot_font_outputs } from "../../godot/font";
import { read_godot_projections } from "../../godot/readable";
import {
  build_tyrano_metadata,
  collect_tyrano_files,
  discover_tyrano_source,
  is_tyrano_root,
  tyrano_path,
  type TyranoSource,
} from "../../tyrano/source";
import { stage_tyrano_source } from "../../tyrano/prepare";
import { create_tyrano_adapter } from "../../tyrano/tyrano-format";
import { read_tyrano_metadata, tyrano_default_status } from "../../tyrano/item";
import { collect_tyrano_fonts, tyrano_font_outputs } from "../../tyrano/font";

type GameSources = {
  RENPY: RenpySource;
  GODOT: GodotSource;
  WOLFRPG: WolfSource;
  RPGMAKER_MV_MZ: RPGMakerSource;
  RPGMAKER_RGSS: RGSSSource;
  TYRANO: TyranoSource;
};
export type GameSource = {
  [K in GameFileType]: Readonly<{ kind: "game"; file_type: K; game: GameSources[K] }>;
}[GameFileType];

/** 登记顺序决定发现优先级。引擎只声明格式行为，正式目录写入归共享事务持有。 */
interface EngineDefinition<G> {
  discover(input: string, fs: NativeFs, signal?: AbortSignal): G | null | Promise<G | null>; // 识别入口并确认加载规则。
  is_root(input: string, fs: NativeFs): unknown; // 目录扫描据此停止递归，避免把游戏成员作为普通来源导入。
  source_path(game: G, input: string): string; // 返回交付给导入流程的来源路径。
  identity(game: G): string; // 多个输入入口按同一游戏身份去重。
  includes_additional_file(game: G, name: string): boolean; // 声明附加原稿的扫描范围，扩展名和翻译成员排除归共享层。
  needs_stage(game: G, fs: NativeFs): boolean; // 判断本次来源是否需要目录准备。
  /** Worker 只写暂存目录，可靠原稿与正式目录计划分别交付。 */
  stage(
    task: Readonly<{ game: G; staging: string }>,
    fs: NativeFs,
    signal?: AbortSignal,
  ): Promise<GamePreparation>;
  /** 正式导入只读定进入原稿容器的数据，字体由字体工具单独收集。 */
  collect(
    game: G,
    fs: NativeFs,
    signal?: AbortSignal,
    prepared?: PreparedGameFiles,
  ): GameSourceData | Promise<GameSourceData>;
  create_adapter(): GameFormatAdapter; // 每次容器操作独享格式上下文。
  read_metadata(extra: Item["extra_field"]): { internal_file_path: string }; // 从条目定位容器成员。
  default_status(item: Pick<Item, "extra_field">): ItemStatus; // 按引擎用途规则确定默认翻译资格。
  /** 只生成可读视图，原件由工作区共享层展开。 */
  workspace_projections?(
    input: GameFiles,
    report?: ProjectionFailure,
    signal?: AbortSignal,
  ): AsyncIterable<ReadableFile>;
  /** 新建导入消费本次快照，固化离线解析需要的语义并交付已完成的读取。来源遗漏由格式按实际依赖解释。 */
  prepare_import?(
    game: G,
    sources: GameImportSources,
    fs: NativeFs,
    signal?: AbortSignal,
    report?: (diagnostic: SourceDiagnostic) => void,
  ): Promise<GameImport>;
  font?: {
    /** 字体工具单独收集配置与字体，避免触发文本提取。 */
    collect(
      game: G,
      fs: NativeFs,
      signal?: AbortSignal,
      prepared?: PreparedGameFiles,
    ): GameSourceFiles | Promise<GameSourceFiles>;
    outputs(game: G, files: GameSourceFiles, font: GameFont): ReadonlyMap<string, Uint8Array>; // 生成同次目录提交的字体及配置。
  };
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
  const { font, prepare_import, ...definition } = engine;
  return {
    ...definition,
    // 能力缺省表示不支持字体修改，准入与执行共用同一声明。
    ...(font && {
      font: {
        collect: (
          source: GameSource,
          fs: NativeFs,
          signal?: AbortSignal,
          prepared?: PreparedGameFiles,
        ) => font.collect(game(source), fs, signal, prepared),
        outputs: (source: GameSource, files: GameSourceFiles, selected: GameFont) =>
          font.outputs(game(source), files, selected),
      },
    }),
    ...(prepare_import && {
      prepare_import: (
        source: GameSource,
        sources: GameImportSources,
        fs: NativeFs,
        signal?: AbortSignal,
        report?: (diagnostic: SourceDiagnostic) => void,
      ) => prepare_import(game(source), sources, fs, signal, report),
    }),
    async discover(input, fs, signal) {
      const found = await engine.discover(input, fs, signal);
      return found ? ({ kind: "game", file_type, game: found } as GameSource) : null;
    },
    source_path: (source, input) => engine.source_path(game(source), input),
    identity: (source) => engine.identity(game(source)),
    includes_additional_file: (source, name) => engine.includes_additional_file(game(source), name),
    needs_stage: (source, fs) => engine.needs_stage(game(source), fs),
    stage: (task, fs, signal) =>
      engine.stage({ game: game(task), staging: task.staging }, fs, signal),
    collect: (source, fs, signal, prepared) => engine.collect(game(source), fs, signal, prepared),
  };
}

export const GAME_ENGINES: Record<GameFileType, GameEngine> = {
  RENPY: register("RENPY", {
    includes_additional_file: (_game, name) => /^game\/(?!cache\/|saves\/)/iu.test(name), // `game/` 外是引擎文件，cache 与 saves 是运行时生成物。
    discover: discover_renpy_source,
    is_root: is_renpy_root,
    source_path: (game) => game.root,
    identity: (game) => game.root,
    needs_stage: () => true,
    stage: stage_renpy_source,
    collect: collect_renpy_files,
    prepare_import: prepare_renpy_import,
    create_adapter: create_renpy_adapter,
    read_metadata: read_renpy_metadata,
    default_status: renpy_default_status,
    workspace_projections: read_renpy_projections,
    font: {
      collect: collect_renpy_fonts,
      outputs: (_game, files, font) => renpy_font_outputs(files.fonts, font),
    },
  }),
  WOLFRPG: register("WOLFRPG", {
    includes_additional_file: () => true,
    discover: discover_wolf_source,
    is_root: wolf_source_root,
    source_path: (game) => game.root,
    identity: (game) => game.root,
    needs_stage: () => true,
    stage: stage_wolf_source,
    collect: (game, fs, signal, prepared) =>
      collect_game_source_files(
        game.root,
        ["Data"],
        (files) => collect_wolf_files(files.keys()),
        null,
        fs,
        signal,
        prepared,
      ).data,
    create_adapter: create_wolf_adapter,
    read_metadata: read_wolf_metadata,
    default_status: wolf_default_status,
    workspace_projections: read_wolf_projections,
    font: {
      collect: (game, fs, signal, prepared) =>
        collect_game_source_files(
          game.root,
          [
            "Data/BasicData",
            ...fs
              .read_dir_names(game.root)
              .filter((name) =>
                GAME_FONT_EXTENSIONS.includes(path.extname(name).slice(1).toLowerCase()),
              ),
          ],
          (files) =>
            [...files.keys()].filter((name) => name.toLowerCase() === "data/basicdata/game.dat"),
          (name) =>
            !name.includes("/") &&
            GAME_FONT_EXTENSIONS.includes(path.extname(name).slice(1).toLowerCase()),
          fs,
          signal,
          prepared,
        ),
      outputs: (_game, files, font) => wolf_font_outputs(files.data, files.fonts, font),
    },
  }),
  RPGMAKER_MV_MZ: register("RPGMAKER_MV_MZ", {
    includes_additional_file: (game, name) => {
      // 数据根目录外是 NW.js 运行时文件。
      const prefix = path.relative(game.root, game.data_root).replaceAll("\\", "/").toLowerCase();
      return prefix === "" || name.toLowerCase().startsWith(prefix + "/");
    },
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
        ["data", "js/plugins", "js/plugins.js"].map(local),
        (files) => collect_rpgmaker_files(game, files.keys()),
        null,
        fs,
        signal,
        prepared,
      ).data;
    },
    create_adapter: create_rpgmaker_mv_mz_adapter,
    read_metadata: read_rpgmaker_metadata,
    default_status: rpgmaker_default_status,
    font: {
      collect: (game, fs, signal, prepared) => {
        const fonts = [path.relative(game.root, game.data_root).replaceAll("\\", "/"), "fonts"]
          .filter(Boolean)
          .join("/");
        return collect_game_source_files(
          game.root,
          [fonts],
          () => [],
          (name) =>
            path.posix.dirname(name).toLowerCase() === fonts.toLowerCase() &&
            GAME_FONT_EXTENSIONS.includes(path.extname(name).slice(1).toLowerCase()),
          fs,
          signal,
          prepared,
        );
      },
      outputs: (game, files, font) => mv_mz_font_outputs(game, files.fonts, font),
    },
  }),
  RPGMAKER_RGSS: register("RPGMAKER_RGSS", {
    includes_additional_file: () => true,
    discover: discover_rgss_source,
    is_root: discover_rgss_source,
    source_path: (game) => game.root,
    identity: (game) => path.join(game.root, game.archive ?? ""),
    needs_stage: (game) => Boolean(game.archive),
    stage: stage_rgss_source,
    collect: (game, fs, signal, prepared) =>
      collect_game_source_files(
        game.root,
        ["Data", "Game.ini"],
        (files, read, collect) => {
          const ini =
            [...files.keys()].find((name) => name.toLowerCase() === "game.ini") ?? "Game.ini";
          let scripts: string;
          try {
            scripts = script_path(read(ini), game.version);
          } catch (error) {
            if (!prepared?.on_read_failure) throw error;
            prepared.on_read_failure(source_diagnostic("read", error, ini));
            return [...files.keys()].filter(
              (name) => name.toLowerCase() === "game.ini" || /\.(?:rxdata|rvdata2?)$/iu.test(name),
            );
          }
          if (!/^Data\//iu.test(scripts)) collect(scripts);
          return collect_rgss_files(files.keys(), scripts);
        },
        null,
        fs,
        signal,
        prepared,
      ).data,
    create_adapter: create_rpgmaker_rgss_adapter,
    read_metadata: read_rgss_metadata,
    default_status: rgss_default_status,
    workspace_projections: read_rgss_projections,
  }),
  GODOT: register("GODOT", {
    includes_additional_file: (_game, name) => !name.toLowerCase().startsWith(".godot/"), // `.godot/` 是编辑器导入缓存。
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
    workspace_projections: read_godot_projections,
    font: {
      collect: collect_godot_fonts,
      outputs: (_game, files, font) => godot_font_outputs(files.data, files.fonts, font.bytes),
    },
  }),
  TYRANO: register("TYRANO", {
    includes_additional_file: (game, name) =>
      name.toLowerCase().startsWith(tyrano_path(game, "data/").toLowerCase()), // 应用 `data` 外是引擎、第三方库与 Electron 运行时。
    discover: discover_tyrano_source,
    is_root: is_tyrano_root,
    source_path: (game) => game.root,
    identity: (game) => game.root,
    needs_stage: (game) => game.archive !== null,
    stage: stage_tyrano_source,
    collect: collect_tyrano_files,
    prepare_import: async (game) => ({ metadata: build_tyrano_metadata(game) }),
    create_adapter: create_tyrano_adapter,
    read_metadata: read_tyrano_metadata,
    default_status: tyrano_default_status,
    font: { collect: collect_tyrano_fonts, outputs: tyrano_font_outputs },
  }),
};

/** 来源准备只在这里选择是否暂存，worker 返回后由同一个事务提交。 */
export async function prepare_game_source(
  source: GameSource,
  fs: NativeFs,
  execute?: GamePrepareExecution,
  signal?: AbortSignal,
  capture?: (prepared: GamePreparation) => Promise<void>,
  report_cleanup?: GameDirectoryCleanupReporter,
): Promise<void> {
  signal?.throwIfAborted();
  let needs_stage: boolean;
  try {
    needs_stage = GAME_ENGINES[source.file_type].needs_stage(source, fs);
  } catch (error) {
    if (signal?.aborted || !capture) throw error;
    await capture({
      sources: { files: new Map(), excluded: [] },
      changes: null,
      diagnostics: [source_diagnostic("prepare", error)],
    });
    return;
  }
  if (!needs_stage) {
    await capture?.(complete_game_preparation("", { writes: [] }));
    return;
  }
  await write_game_directory(
    source.game.root,
    fs,
    async (staging) => {
      const task = { ...source, staging };
      const prepared = await (execute
        ? execute(task, signal)
        : GAME_ENGINES[source.file_type].stage(task, fs, signal));
      await capture?.(prepared);
      if (!prepared.changes && !capture)
        throw new Error(
          prepared.diagnostics.map((diagnostic) => diagnostic.error.message).join("\n") ||
            "Incomplete game preparation",
          { cause: prepared.diagnostics },
        );
      return prepared.changes;
    },
    signal,
    report_cleanup,
  );
}
