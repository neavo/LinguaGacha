import { RPGMakerMvMzFormat } from "./rpgmaker-mv-mz/rpgmaker-format";
import { discover_rpgmaker_source, identify_rpgmaker_file } from "./rpgmaker-mv-mz/source";
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
    this.rpgmaker = new RPGMakerMvMzFormat(config);
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
      identify_rpgmaker_file(file_path, this.native_fs)
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
    if (type === undefined && path.extname(rel_path).toLowerCase() === ".json") {
      const data: unknown = JSON.parse(await decode_text_content(content));
      type = Array.isArray(data)
        ? "MESSAGEJSON"
        : data !== null && typeof data === "object"
          ? "KVJSON"
          : "NONE";
    }
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
      TRANS: this.trans,
      KVJSON: this.kvjson,
      MESSAGEJSON: this.messagejson,
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
    return identify_rpgmaker_file(source_path, this.native_fs) ? "RPGMAKER_MV_MZ" : undefined;
  }

  /**
   * 收集源路径下所有支持文件，并为重复相对路径生成稳定去重名
   */
  public collect_source_file_entries(source_paths: string[]): ProjectSourceFileEntry[] {
    const normalized_source_paths = this.normalize_source_paths(source_paths);
    const candidates: ProjectSourceFileEntry[] = [];
    const seen_file_keys = new Set<string>();
    const game_roots = new Set<string>();
    for (const source_path of normalized_source_paths) {
      const game = discover_rpgmaker_source(source_path, this.native_fs);
      if (game !== null) {
        const root = this.native_fs.stat(source_path).isDirectory()
          ? source_path
          : path.dirname(source_path);
        game_roots.add(this.build_path_identity_key(root));
        if (game_roots.size > 1)
          throw new AppError("request.validation_failed", {
            diagnostic_context: { reason: "multiple_rpgmaker_games" },
          });
      }
      const entries =
        game ??
        this.collect_source_files(source_path).map((file) => ({
          source_path: file,
          rel_path: this.build_source_relative_path(source_path, file),
        }));
      for (const entry of entries) {
        const source_file = entry.source_path;
        const file_key = this.build_path_identity_key(source_file);
        if (seen_file_keys.has(file_key)) {
          continue;
        }
        seen_file_keys.add(file_key);
        const file_type = game ? "RPGMAKER_MV_MZ" : this.source_file_type(source_file);
        candidates.push({ ...entry, ...(file_type === undefined ? {} : { file_type }) });
      }
    }
    const used_rel_paths = new Set<string>();
    return candidates.map((entry, index) => {
      if (
        entry.file_type === "RPGMAKER_MV_MZ" &&
        used_rel_paths.has(this.relative_path_key(entry.rel_path))
      )
        throw new AppError("request.validation_failed", {
          diagnostic_context: { reason: "rpgmaker_path_collision", path: entry.rel_path },
        });
      return {
        ...entry,
        rel_path: this.build_unique_relative_path(entry.rel_path, used_rel_paths, index),
      };
    });
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
    await this.txt.write_to_path(items, paths);
    await this.md.write_to_path(items, paths);
    await this.write_subtitles(items, context);
    await this.kvjson.write_to_path(items, paths, asset_reader);
    await this.messagejson.write_to_path(items, paths);
    await this.xlsx.write_to_path(items, paths, asset_reader);
    await this.trans.write_to_path(items, paths, asset_reader);
    await this.renpy.write_to_path(items, paths, asset_reader);
    await this.epub.write_to_path(items, paths, asset_reader);
    for (const file of context.source_files) {
      if (file.file_type !== "RPGMAKER_MV_MZ") continue;
      const bytes = asset_reader(file.path);
      if (bytes === null)
        throw new AppError("file.not_found", { public_details: { file: file.path } });
      const output = await this.rpgmaker.render(
        bytes,
        file.path,
        items.filter((item) => item.file_path === file.path),
      );
      await this.native_fs.write_file(path.join(paths.translated_path, file.path), output);
    }
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
   * 递归收集目录内支持文件，保持文件输入和目录输入共用一套过滤
   */
  private collect_source_files(source_path: string): string[] {
    if (!this.native_fs.exists(source_path)) {
      return [];
    }
    const stat = this.native_fs.stat(source_path);
    if (stat.isFile()) {
      return this.is_supported_file(source_path) ? [source_path] : [];
    }
    if (!stat.isDirectory()) {
      return [];
    }
    const result: string[] = [];
    const entries = this.native_fs
      .read_dirents(source_path)
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const entry_path = path.join(source_path, entry.name);
      if (entry.isDirectory()) {
        result.push(...this.collect_source_files(entry_path));
      } else if (entry.isFile() && this.is_supported_file(entry_path)) {
        result.push(entry_path);
      }
    }
    return result;
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

  /**
   * 多个源目录产生同名相对路径时追加序号，避免覆盖工程 asset
   */
  private build_unique_relative_path(
    rel_path: string,
    used_rel_paths: Set<string>,
    source_index: number,
  ): string {
    const key = this.relative_path_key(rel_path);
    if (!used_rel_paths.has(key)) {
      used_rel_paths.add(key);
      return rel_path;
    }
    const parsed = path.parse(rel_path);
    let unique_index = source_index + 1;
    for (;;) {
      const candidate = path.join(parsed.dir, `${parsed.name}_${unique_index}${parsed.ext}`);
      const candidate_key = this.relative_path_key(candidate);
      if (!used_rel_paths.has(candidate_key)) {
        used_rel_paths.add(candidate_key);
        return candidate;
      }
      unique_index += 1;
    }
  }

  /**
   * 工程内相对路径比较统一使用斜杠和小写，贴近 Windows 用户预期
   */
  private relative_path_key(rel_path: string): string {
    return rel_path.replace(/\\/gu, "/").toLowerCase();
  }
}
