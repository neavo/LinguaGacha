import { create_wolf_adapter } from "./wolf3/wolf-format";
import { wolf_default_status } from "./wolf3/item";
import { prepare_wolf_source } from "./wolf3/prepare";
import { collect_wolf_files } from "./wolf3/source";
import { GameFormat } from "./game/format";
import { build_source_file_parse_failure } from "./source-file-parse-failure-reporter";
import {
  discover_source,
  discover_sources,
  assert_source_identities,
  type DiscoveredSource,
} from "./source-discovery";
import { prepare_rpgmaker_source } from "./rpgmaker-mv-mz/prepare";
import type { GamePrepareExecution } from "./game/prepare-worker";
import { rpgmaker_default_status } from "./rpgmaker-mv-mz/item";
import { rgss_default_status } from "./rpgmaker-rgss/item";
import { create_rpgmaker_rgss_adapter } from "./rpgmaker-rgss/rpgmaker-format";
import { collect_rgss_files } from "./rpgmaker-rgss/source";
import { prepare_rgss_source } from "./rpgmaker-rgss/prepare";
import { is_game_file_type, type GameFileType } from "../../shared/project-source-formats";
import { format_local_timestamp } from "../../shared/utils/format-local-timestamp";
import { normalize_project_asset_path } from "../../shared/project/project-asset-paths";
import { SourceFilePathIndex } from "./source-file-paths";
import { create_rpgmaker_mv_mz_adapter } from "./rpgmaker-mv-mz/rpgmaker-format";
import { collect_rpgmaker_files } from "./rpgmaker-mv-mz/source";
import type { PDFExecution } from "./pdf/pdf-worker";
import { PDFFormat } from "./pdf/pdf-format";
import path from "node:path";

import { type Item, type ItemFileType, type ItemStatus } from "../../domain/item";
import { ASSFormat } from "./subtitle/ass-ssa-format";
import { KVJSONFormat } from "./kvjson/kvjson-format";
import { MDV2Format } from "./markdown/md-v2-format";
import { MESSAGEJSONFormat } from "./messagejson/messagejson-format";
import { RenPyFormat } from "./renpy/renpy-format";
import { SRTFormat } from "./subtitle/srt-format";
import { VTTFormat } from "./subtitle/vtt-format";
import { LRCFormat } from "./subtitle/lrc-format";
import { AppError } from "../../shared/error";
import { decode_text_content } from "../../shared/utils/text-tool";
import { JsonTool } from "../../shared/utils/json-tool";
import type { JsonValue } from "../../domain/json";
import { TRANSFormat } from "./trans/trans-format";
import { TXTFormat } from "./txt/txt-format";
import { XLSXFormat } from "./xlsx/xlsx-format";
import { EPUBFormat } from "./epub/epub-format";
import { NativeFs, default_native_fs } from "../../native/native-fs";
import {
  type FileFormatReadResult,
  type FileFormatServiceWriteContext,
  type FileFormatServiceConfig,
  type ProjectSourceFileEntry,
} from "./file-format-types";
import {
  PROJECT_SOURCE_FORMATS,
  type ProjectSourceFormatHitCounts,
  type ProjectSourceFileSummary,
} from "../../shared/project-source-formats";

/**
 * Backend 公开文件格式门面；具体格式逻辑按稳定格式处理器拆分
 */
export class FileFormatService {
  /** 文件重置由格式决定翻译资格，工程服务不解释私有定位。 */
  public static default_status(item: Pick<Item, "file_type" | "extra_field">): ItemStatus {
    if (item.file_type === "RPGMAKER_MV_MZ") return rpgmaker_default_status(item);
    if (item.file_type === "RPGMAKER_RGSS") return rgss_default_status(item);
    if (item.file_type === "WOLF3") return wolf_default_status(item);
    return "NONE";
  }

  private readonly native_fs: NativeFs; // 文件发现与字幕写入复用的磁盘入口
  // 格式处理器随服务实例固定，解析与写回始终复用同一组配置。
  private readonly txt: TXTFormat;
  private readonly md: MDV2Format;
  private readonly ass: ASSFormat;
  private readonly srt: SRTFormat;
  private readonly vtt: VTTFormat;
  private readonly lrc: LRCFormat;
  private readonly kvjson: KVJSONFormat;
  private readonly messagejson: MESSAGEJSONFormat;
  private readonly xlsx: XLSXFormat;
  private readonly trans: TRANSFormat;
  private readonly renpy: RenPyFormat;
  private readonly epub: EPUBFormat;
  private readonly games: Record<GameFileType, GameFormat>;

  /**
   * 构造时固定各格式处理器，保证一次服务实例内配置一致
   */
  public constructor(
    config: FileFormatServiceConfig,
    private readonly pdf_execution: PDFExecution,
    native_fs: NativeFs = default_native_fs,
    private readonly game_prepare_execution?: GamePrepareExecution,
  ) {
    this.native_fs = native_fs;
    this.games = {
      RPGMAKER_MV_MZ: new GameFormat(create_rpgmaker_mv_mz_adapter(config), native_fs),
      RPGMAKER_RGSS: new GameFormat(create_rpgmaker_rgss_adapter(), native_fs),
      WOLF3: new GameFormat(create_wolf_adapter(), native_fs),
    };
    this.txt = new TXTFormat(config);
    this.md = new MDV2Format();
    this.ass = new ASSFormat(config);
    this.srt = new SRTFormat(config);
    this.vtt = new VTTFormat(config);
    this.lrc = new LRCFormat(config);
    this.kvjson = new KVJSONFormat();
    this.messagejson = new MESSAGEJSONFormat(config);
    this.xlsx = new XLSXFormat();
    this.trans = new TRANSFormat();
    this.renpy = new RenPyFormat(config);
    this.epub = new EPUBFormat(config);
  }

  /**
   * 保存身份优先分发，新来源的 JSON 和 XLSX 按内容识别。
   */
  public async parse_asset(
    rel_path: string,
    content: Uint8Array,
    file_type?: string,
  ): Promise<FileFormatReadResult> {
    if (is_game_file_type(file_type))
      return {
        kind: "items",
        file_type,
        ...(await this.games[file_type].read_from_stream(content, rel_path)),
      };
    const by_extension: Record<string, string> = {
      ".txt": "TXT",
      ".md": "MD_V2",
      ".ass": "ASS",
      ".ssa": "ASS",
      ".srt": "SRT",
      ".vtt": "VTT",
      ".lrc": "LRC",
      ".epub": "EPUB",
      ".rpy": "RENPY",
      ".trans": "TRANS",
      ".pdf": "PDF",
    };
    let type = file_type ?? by_extension[path.extname(rel_path).toLowerCase()];
    if (
      type === "KVJSON" ||
      type === "MESSAGEJSON" ||
      (type === undefined && path.extname(rel_path).toLowerCase() === ".json")
    ) {
      const text = await decode_text_content(content);
      // 新来源保持标准 JSON 接受范围，已保存身份沿用历史非有限数值兼容。
      const data =
        type === undefined
          ? (JSON.parse(text) as JsonValue)
          : JsonTool.parseStrict<JsonValue>(text);
      type ??= Array.isArray(data)
        ? "MESSAGEJSON"
        : data !== null && typeof data === "object"
          ? "KVJSON"
          : "NONE";
      return {
        kind: "items",
        file_type: type as ItemFileType,
        items:
          type === "KVJSON"
            ? this.kvjson.read_items(data, rel_path)
            : type === "MESSAGEJSON"
              ? this.messagejson.read_items(data, rel_path)
              : [],
      };
    }
    if (type === "TRANS")
      return { kind: "items", file_type: type, ...this.trans.read_from_stream(content, rel_path) };
    if (type === "PDF")
      return {
        kind: "pdf",
        document: await new PDFFormat(this.pdf_execution).read_from_stream(content),
      };
    if (
      type === "XLSX" ||
      type === "WOLFXLSX" ||
      (type === undefined && path.extname(rel_path).toLowerCase() === ".xlsx")
    )
      return {
        kind: "items",
        ...(await this.xlsx.read_asset(
          content,
          rel_path,
          file_type === "XLSX" || file_type === "WOLFXLSX" ? file_type : undefined,
        )),
      };
    const formats = {
      TXT: this.txt,
      MD_V2: this.md,
      ASS: this.ass,
      SRT: this.srt,
      VTT: this.vtt,
      LRC: this.lrc,
      EPUB: this.epub,
      RENPY: this.renpy,
    };
    if (!type || !Object.hasOwn(formats, type))
      return { kind: "items", file_type: "NONE", items: [] };
    const format = formats[type as keyof typeof formats];
    return {
      kind: "items",
      file_type: type as ItemFileType,
      items: await format.read_from_stream(content, rel_path),
    };
  }

  /** 新建、摘要和预览共用发现结果，正式导入重新识别本次选定来源。 */
  public async collect_source_file_entries(
    source_paths: string[],
    signal?: AbortSignal,
  ): Promise<DiscoveredSource[]> {
    return discover_sources(source_paths, this.native_fs, signal);
  }

  /** 导入确认后的目标路径固定；识别错误也保留在同一批次中。 */
  public async discover_import_sources(
    entries: readonly ProjectSourceFileEntry[],
    signal?: AbortSignal,
  ): Promise<DiscoveredSource[]> {
    const result: DiscoveredSource[] = [];
    for (const entry of entries) {
      const resolved = await discover_source(entry.source_path, this.native_fs, signal);
      result.push({
        ...resolved,
        rel_path: entry.rel_path,
        file_type: entry.file_type ?? resolved.file_type,
      });
    }
    assert_source_identities(result, this.native_fs);
    return result;
  }

  /** 预览保留已有同名资产供用户确认替换，祖先路径冲突改名到可共同投影的位置。 */
  public assign_source_file_paths<T extends ProjectSourceFileEntry>(
    entries: readonly T[],
    existing_files: readonly { path: string; file_type: string }[] = [],
  ): T[] {
    const timestamp = format_local_timestamp(new Date().toISOString())!
      .replaceAll("-", "")
      .replaceAll(":", "")
      .replace(" ", "_");
    const existing = new SourceFilePathIndex();
    for (const file of existing_files) existing.add(file.path, file.file_type);
    const original = new SourceFilePathIndex(); // 自动名称不能抢占尚未分配的原始候选。
    for (const entry of entries) original.reserve(entry.rel_path, entry.file_type);
    const assigned = new SourceFilePathIndex();
    const result: T[] = [...entries];
    const directories = new Map<string, string>(); // 同一准备操作中的目录前缀只改名一次，子文件共同迁移。
    // 普通目录先占位，游戏避让；结果仍按用户输入顺序返回。
    const order = entries
      .map((entry, index) => ({ entry, index }))
      .sort(
        (left, right) =>
          Number(is_game_file_type(left.entry.file_type)) -
          Number(is_game_file_type(right.entry.file_type)),
      );
    for (const { entry, index } of order) {
      const parts = normalize_project_asset_path(entry.rel_path).split("/");
      for (let length = 1; length < parts.length; length += 1) {
        const renamed = directories.get(parts.slice(0, length).join("/").toLowerCase());
        if (renamed !== undefined) {
          parts.splice(0, length, ...renamed.split("/"));
          break;
        }
      }
      let candidate = path.join(...parts);
      const unchanged =
        normalize_project_asset_path(candidate) === normalize_project_asset_path(entry.rel_path);
      const conflict =
        existing.find_conflict(candidate, entry.file_type, unchanged) ??
        assigned.find_conflict(candidate, entry.file_type);
      if (conflict !== null) {
        const component = conflict.split("/").length - 1;
        const prefix = parts.slice(0, component + 1);
        const is_directory = component < parts.length - 1;
        const parsed = !is_directory
          ? path.parse(prefix[component]!)
          : { name: prefix[component]!, ext: "" };
        const name = parsed.name + "_" + timestamp;
        let suffix = 1;
        let renamed: string;
        do {
          prefix[component] = name + (suffix === 1 ? "" : "_" + suffix) + parsed.ext;
          renamed = prefix.join("/");
          suffix += 1;
        } while (
          existing.find_conflict(renamed, is_directory ? undefined : entry.file_type) !== null ||
          assigned.find_conflict(renamed, is_directory ? undefined : entry.file_type) !== null ||
          original.find_conflict(renamed, is_directory ? undefined : entry.file_type) !== null
        );
        if (is_directory)
          directories.set(
            parts
              .slice(0, component + 1)
              .join("/")
              .toLowerCase(),
            renamed,
          );
        parts.splice(0, component + 1, ...prefix);
        candidate = path.join(...parts);
      }
      assigned.add(candidate, entry.file_type);
      result[index] = { ...entry, rel_path: candidate };
    }
    return result;
  }

  /** 正式导入先准备游戏目录，再固化容器，后续解析使用保存的原稿。 */
  public async prepare_source(entry: DiscoveredSource, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const { source, rel_path } = entry;
    if (source.kind === "failure") throw source.error;
    if (source.kind === "wolf3") {
      await prepare_wolf_source(source.game, this.native_fs, this.game_prepare_execution, signal);
      return this.games.WOLF3.prepare_source(
        collect_wolf_files(source.game, this.native_fs),
        rel_path,
        { root: source.game.root, engine: "wolf3" },
        signal,
      );
    }
    if (source.kind === "rgss") {
      await prepare_rgss_source(source.game, this.native_fs, this.game_prepare_execution, signal);
      return this.games.RPGMAKER_RGSS.prepare_source(
        collect_rgss_files(source.game, this.native_fs),
        rel_path,
        { root: source.game.root, engine: source.game.version },
        signal,
      );
    }
    if (source.kind === "mv_mz") {
      await prepare_rpgmaker_source(
        source.game,
        this.native_fs,
        this.game_prepare_execution,
        signal,
      );
      return this.games.RPGMAKER_MV_MZ.prepare_source(
        collect_rpgmaker_files(source.game, this.native_fs),
        rel_path,
        { root: source.game.root, engine: source.game.engine },
        signal,
      );
    }
    return { content: this.native_fs.read_file(entry.source_path), warnings: [] };
  }

  /**
   * 按文件发现的同一去重口径汇总总数和互斥扩展名命中数，不提前解析文件内容。
   */
  public async summarize_source_files(source_paths: string[]): Promise<ProjectSourceFileSummary> {
    const entries = await this.collect_source_file_entries(source_paths);
    const source_files = entries.filter((entry) => entry.source.kind !== "failure");
    const failed_files = entries.flatMap((entry) =>
      entry.source.kind === "failure"
        ? [build_source_file_parse_failure({ ...entry, error: entry.source.error })]
        : [],
    );
    const format_hit_counts = Object.fromEntries(
      PROJECT_SOURCE_FORMATS.map((format) => [format.id, 0]),
    ) as ProjectSourceFormatHitCounts;

    for (const source_file of source_files) {
      const format_id =
        source_file.source.kind === "wolf3"
          ? "wolf3"
          : source_file.source.kind === "mv_mz"
            ? "rpgmaker_mv_mz"
            : source_file.source.kind === "rgss"
              ? "rpgmaker_rgss"
              : source_file.source.kind === "file"
                ? source_file.source.format
                : undefined;
      if (format_id !== undefined) {
        format_hit_counts[format_id] += 1;
      }
    }

    return {
      ...(failed_files.length ? { failed_files } : {}),
      source_file_count: source_files.length,
      format_hit_counts,
    };
  }

  /**
   * 字幕按资产文件集合调度，其余格式继续消费各自的条目集合。
   */
  public async write_items(items: Item[], context: FileFormatServiceWriteContext): Promise<void> {
    const { paths, asset_reader } = context;
    for (const game of Object.values(this.games)) await game.write_to_path(items, context);
    await this.txt.write_to_path(items, paths);
    await this.md.write_to_path(items, paths);
    await this.write_subtitles(items, context);
    await this.kvjson.write_to_path(items, paths, asset_reader);
    await this.messagejson.write_to_path(items, paths);
    await this.xlsx.write_to_path(items, paths, asset_reader);
    await this.trans.write_to_path(items, paths, asset_reader);
    await this.renpy.write_to_path(items, paths, asset_reader);
    await this.epub.write_to_path(items, paths, asset_reader);
  }

  /** 文件集合拥有导出调度，格式处理器只组装当前文件的两种正文。 */
  private async write_subtitles(
    items: Item[],
    context: FileFormatServiceWriteContext,
  ): Promise<void> {
    const by_file = new Map<string, Item[]>();
    for (const item of items) {
      const group = by_file.get(item.file_path) ?? [];
      group.push(item);
      by_file.set(item.file_path, group);
    }
    for (const record of context.source_files) {
      const file = record.path;
      const file_items = by_file.get(file) ?? [];
      const file_type = record.file_type as ItemFileType;
      const subtitle = this.read_subtitle_format(file_type);
      if (!subtitle) continue;
      const asset = await context.asset_reader(file);
      if (asset === null) throw new AppError("file.not_found", { public_details: { file } });
      const text = await decode_text_content(asset);
      const output = subtitle.format.render_text(text, file_items, file);
      // 格式计算和校验完成后才落盘，避免单语写出后才发现双语结构错误。
      await this.native_fs.write_file(
        path.join(context.paths.translated_path, file),
        output.translated,
      );
      await this.native_fs.write_file(
        path.join(context.paths.bilingual_path, file),
        output.bilingual,
      );
    }
  }

  /** 导入与导出共用处理器选择，来源类型与扩展名别名汇入同一入口。 */
  private read_subtitle_format(file_type: ItemFileType | null): {
    file_type: ItemFileType;
    format: ASSFormat | SRTFormat | VTTFormat | LRCFormat;
  } | null {
    switch (file_type) {
      case "ASS":
        return { file_type, format: this.ass };
      case "SRT":
        return { file_type, format: this.srt };
      case "VTT":
        return { file_type, format: this.vtt };
      case "LRC":
        return { file_type, format: this.lrc };
      default:
        return null;
    }
  }
}
