import { format_local_timestamp } from "../../shared/utils/format-local-timestamp";
import { normalize_project_asset_path } from "../../shared/project/project-asset-paths";
import { SourceFilePathIndex } from "./source-file-paths";
import { RPGMakerMvMzFormat } from "./rpgmaker-mv-mz/rpgmaker-format";
import { discover_rpgmaker_source } from "./rpgmaker-mv-mz/source";
import type { PDFExecution } from "./pdf/pdf-worker";
import { PDFFormat } from "./pdf/pdf-format";
import path from "node:path";

import { type Item, type ItemFileType } from "../../domain/item";
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
} from "./file-format-shared";
import {
  PROJECT_SOURCE_FORMATS,
  type ProjectSourceFormatId,
  type ProjectSourceFormatHitCounts,
  type ProjectSourceFileSummary,
} from "../../shared/project-source-formats";

// 文件发现与摘要统计共用同一扩展名映射，避免支持范围产生第二份白名单。
const PROJECT_SOURCE_FORMAT_ID_BY_EXTENSION = new Map<string, ProjectSourceFormatId>(
  PROJECT_SOURCE_FORMATS.filter((format) => format.id !== "rpgmaker_mv_mz").map((format) => [
    format.extension,
    format.id,
  ]),
);

/**
 * Backend 公开文件格式门面；具体格式逻辑按稳定格式处理器拆分
 */
export class FileFormatService {
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
  private readonly rpgmaker: RPGMakerMvMzFormat;

  /**
   * 构造时固定各格式处理器，保证一次服务实例内配置一致
   */
  public constructor(
    config: FileFormatServiceConfig,
    private readonly pdf_execution: PDFExecution,
    native_fs: NativeFs = default_native_fs,
  ) {
    this.native_fs = native_fs;
    this.rpgmaker = new RPGMakerMvMzFormat(config, native_fs);
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
   * 判断公开文件域可接收的源文件格式
   */
  public is_supported_file(file_path: string): boolean {
    return (
      PROJECT_SOURCE_FORMAT_ID_BY_EXTENSION.has(path.extname(file_path).toLowerCase()) ||
      discover_rpgmaker_source(file_path, this.native_fs) !== null
    );
  }

  /**
   * 保存身份优先分发，新来源的 JSON 和 XLSX 按内容识别。
   */
  public async parse_asset(
    rel_path: string,
    content: Uint8Array,
    file_type?: string,
  ): Promise<FileFormatReadResult> {
    if (file_type === "RPGMAKER_MV_MZ")
      return {
        kind: "items",
        file_type,
        ...(await this.rpgmaker.read_from_stream(content, rel_path)),
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

  /** 来源目录只决定新文件的原生游戏身份。 */
  public source_file_type(source_path: string): string | undefined {
    return discover_rpgmaker_source(source_path, this.native_fs) !== null
      ? "RPGMAKER_MV_MZ"
      : undefined;
  }

  /**
   * 发现独立来源并按物理路径去重，保留原始候选名称
   */
  public collect_source_file_entries(source_paths: string[]): ProjectSourceFileEntry[] {
    const normalized_source_paths = this.normalize_source_paths(source_paths);
    const candidates: ProjectSourceFileEntry[] = [];
    const seen_file_keys = new Set<string>();
    const visit = (source_path: string, source_root: string): void => {
      if (!this.native_fs.exists(source_path)) return;
      const game = discover_rpgmaker_source(source_path, this.native_fs);
      if (game !== null) {
        const key = this.build_path_identity_key(game.root);
        if (!seen_file_keys.has(key)) {
          seen_file_keys.add(key);
          candidates.push({
            source_path: game.root,
            rel_path: path.basename(game.root) + ".zip",
            file_type: "RPGMAKER_MV_MZ",
          });
        }
        return; // 游戏收集器拥有内部文件，通用扫描到此结束。
      }
      const stat = this.native_fs.stat(source_path);
      if (stat.isDirectory()) {
        for (const entry of this.native_fs
          .read_dirents(source_path)
          .sort((a, b) => a.name.localeCompare(b.name))) {
          if (entry.isDirectory() || entry.isFile())
            visit(path.join(source_path, entry.name), source_root);
        }
      } else if (stat.isFile() && this.is_supported_file(source_path)) {
        const key = this.build_path_identity_key(source_path);
        if (seen_file_keys.has(key)) return;
        seen_file_keys.add(key);
        candidates.push({
          source_path,
          rel_path: this.build_source_relative_path(source_root, source_path),
        });
      }
    };
    for (const source_path of normalized_source_paths) visit(source_path, source_path);
    const game_roots = candidates
      .filter((entry) => entry.file_type === "RPGMAKER_MV_MZ")
      .map((entry) => this.build_path_identity_key(entry.source_path));
    const sources = candidates.filter((entry) => {
      const key = this.build_path_identity_key(entry.source_path);
      return !game_roots.some((root) => key !== root && key.startsWith(root + path.sep));
    });
    return sources;
  }

  /** 预览保留已有同名资产供用户确认替换，祖先路径冲突改名到可共同投影的位置。 */
  public assign_source_file_paths(
    entries: readonly ProjectSourceFileEntry[],
    existing_files: readonly { path: string; file_type: string }[] = [],
  ): ProjectSourceFileEntry[] {
    const timestamp = format_local_timestamp(new Date().toISOString())!
      .replaceAll("-", "")
      .replaceAll(":", "")
      .replace(" ", "_");
    const existing = new SourceFilePathIndex();
    for (const file of existing_files) existing.add(file.path, file.file_type);
    const original = new SourceFilePathIndex(); // 自动名称不能抢占尚未分配的原始候选。
    for (const entry of entries) original.reserve(entry.rel_path, entry.file_type);
    const assigned = new SourceFilePathIndex();
    const result: ProjectSourceFileEntry[] = [...entries];
    const directories = new Map<string, string>(); // 同一准备操作中的目录前缀只改名一次，子文件共同迁移。
    // 普通目录先占位，游戏避让；结果仍按用户输入顺序返回。
    const order = entries
      .map((entry, index) => ({ entry, index }))
      .sort(
        (left, right) =>
          Number(left.entry.file_type === "RPGMAKER_MV_MZ") -
          Number(right.entry.file_type === "RPGMAKER_MV_MZ"),
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

  /** 游戏先固化容器，后续解析不再依赖磁盘来源。 */
  public async prepare_source(source_path: string, rel_path: string, file_type?: string) {
    if (file_type === "RPGMAKER_MV_MZ") return this.rpgmaker.prepare_source(source_path, rel_path);
    return { content: this.native_fs.read_file(source_path), warnings: [] };
  }

  /**
   * 按文件发现的同一去重口径汇总总数和互斥扩展名命中数，不提前解析文件内容。
   */
  public summarize_source_files(source_paths: string[]): ProjectSourceFileSummary {
    const source_files = this.collect_source_file_entries(source_paths);
    const format_hit_counts = Object.fromEntries(
      PROJECT_SOURCE_FORMATS.map((format) => [format.id, 0]),
    ) as ProjectSourceFormatHitCounts;

    for (const source_file of source_files) {
      const format_id =
        source_file.file_type === "RPGMAKER_MV_MZ"
          ? "rpgmaker_mv_mz"
          : PROJECT_SOURCE_FORMAT_ID_BY_EXTENSION.get(
              path.extname(source_file.source_path).toLowerCase(),
            );
      if (format_id !== undefined) {
        format_hit_counts[format_id] += 1;
      }
    }

    return {
      source_file_count: source_files.length,
      format_hit_counts,
    };
  }

  /**
   * 对用户传入的文件/目录路径去空和去重，保持后续排序来源稳定
   */
  public normalize_source_paths(source_paths: string[]): string[] {
    const normalized_paths: string[] = [];
    const seen_keys = new Set<string>();
    for (const source_path of source_paths) {
      if (source_path.trim() === "") {
        continue;
      }
      const path_key = this.build_path_identity_key(source_path);
      if (seen_keys.has(path_key)) {
        continue;
      }
      seen_keys.add(path_key);
      normalized_paths.push(source_path);
    }
    return normalized_paths;
  }

  /**
   * 字幕按资产文件集合调度，其余格式继续消费各自的条目集合。
   */
  public async write_items(items: Item[], context: FileFormatServiceWriteContext): Promise<void> {
    const { paths, asset_reader } = context;
    await this.rpgmaker.write_to_path(items, context);
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

  /**
   * Windows 路径比较大小写不敏感，去重 key 必须按平台归一化
   */
  private build_path_identity_key(source_path: string): string {
    return this.native_fs.to_identity_path(source_path);
  }

  /**
   * 目录输入保留入口目录名和内部结构，单文件输入只使用文件名
   */
  private build_source_relative_path(source_root: string, source_file: string): string {
    if (this.native_fs.exists(source_root) && this.native_fs.stat(source_root).isFile()) {
      return path.basename(source_file);
    }
    return path.relative(path.dirname(source_root), source_file) || path.basename(source_file);
  }
}
