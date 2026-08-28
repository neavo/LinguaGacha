import path from "node:path";

import { Item, type ItemFileType } from "../../domain/item";
import { ASSFormat } from "./formats/ass-format";
import { KVJSONFormat } from "./formats/kvjson-format";
import { MDV2Format } from "./formats/markdown/md-v2-format";
import { PDFFormat } from "./formats/pdf/pdf-format";
import { MESSAGEJSONFormat } from "./formats/messagejson-format";
import { RenPyFormat } from "./formats/renpy/renpy-format";
import { SRTFormat } from "./formats/srt-format";
import { TRANSFormat } from "./formats/trans/trans-format";
import { TXTFormat } from "./formats/txt-format";
import { WOLFXLSXFormat } from "./formats/wolfxlsx-format";
import { XLSXFormat } from "./formats/xlsx-format";
import { EPUBFormat } from "./formats/epub/epub-format";
import { NativeFs, default_native_fs } from "../../native/native-fs";
import {
  type FileFormatWriteContext,
  type FileFormatServiceConfig,
  type ProjectSourceFileEntry,
} from "../file/formats/file-format-shared";
import {
  PROJECT_SOURCE_FORMATS,
  type ProjectSourceFormatId,
  type ProjectSourceFormatHitCounts,
  type ProjectSourceFileSummary,
} from "../../shared/project-source-formats";

// 文件发现与摘要统计共用同一扩展名映射，避免支持范围产生第二份白名单。
const PROJECT_SOURCE_FORMAT_ID_BY_EXTENSION = new Map<string, ProjectSourceFormatId>(
  PROJECT_SOURCE_FORMATS.map((format) => [format.extension, format.id]),
);

/**
 * Backend 公开文件格式门面；具体格式逻辑按稳定格式处理器拆分
 */
export class FileFormatService {
  private readonly native_fs: NativeFs; // 源文件扫描和预览读取的唯一磁盘入口
  // 格式处理器随服务实例固定，解析与写回始终复用同一组配置。
  private readonly txt: TXTFormat;
  private readonly md: MDV2Format;
  private readonly pdf: PDFFormat;
  private readonly ass: ASSFormat;
  private readonly srt: SRTFormat;
  private readonly kvjson: KVJSONFormat;
  private readonly messagejson: MESSAGEJSONFormat;
  private readonly xlsx: XLSXFormat;
  private readonly wolfxlsx: WOLFXLSXFormat;
  private readonly trans: TRANSFormat;
  private readonly renpy: RenPyFormat;
  private readonly epub: EPUBFormat;

  /**
   * 构造时固定各格式处理器，保证一次服务实例内配置一致
   */
  public constructor(config: FileFormatServiceConfig, native_fs: NativeFs = default_native_fs) {
    this.native_fs = native_fs;
    this.txt = new TXTFormat(config);
    this.md = new MDV2Format();
    this.pdf = new PDFFormat();
    this.ass = new ASSFormat(config);
    this.srt = new SRTFormat(config);
    this.kvjson = new KVJSONFormat();
    this.messagejson = new MESSAGEJSONFormat(config);
    this.xlsx = new XLSXFormat();
    this.wolfxlsx = new WOLFXLSXFormat();
    this.trans = new TRANSFormat();
    this.renpy = new RenPyFormat(config);
    this.epub = new EPUBFormat(config);
  }

  /**
   * 判断公开文件域可接收的源文件格式
   */
  public is_supported_file(file_path: string): boolean {
    return PROJECT_SOURCE_FORMAT_ID_BY_EXTENSION.has(path.extname(file_path).toLowerCase());
  }

  /**
   * 按扩展名分发到具体格式处理器，JSON/XLSX 保持历史优先级回退顺序
   */
  public async parse_asset(rel_path: string, content: Uint8Array): Promise<Item[]> {
    const ext = path.extname(rel_path).toLowerCase();
    if (ext === ".md") {
      return this.md.read_from_stream(content, rel_path);
    }
    if (ext === ".pdf") {
      return this.pdf.read_from_stream(content, rel_path);
    }
    if (ext === ".txt") {
      return this.txt.read_from_stream(content, rel_path);
    }
    if (ext === ".ass") {
      return this.ass.read_from_stream(content, rel_path);
    }
    if (ext === ".srt") {
      return this.srt.read_from_stream(content, rel_path);
    }
    if (ext === ".xlsx") {
      const wolf_items = await this.wolfxlsx.read_from_stream(content, rel_path);
      return wolf_items.length > 0
        ? wolf_items
        : await this.xlsx.read_from_stream(content, rel_path);
    }
    if (ext === ".json") {
      const kv_items = await this.kvjson.read_from_stream(content, rel_path);
      return kv_items.length > 0
        ? kv_items
        : await this.messagejson.read_from_stream(content, rel_path);
    }
    if (ext === ".trans") {
      return this.trans.read_from_stream(content, rel_path);
    }
    if (ext === ".rpy") {
      return this.renpy.read_from_stream(content, rel_path);
    }
    if (ext === ".epub") {
      return this.epub.read_from_stream(content, rel_path);
    }
    return [];
  }

  /**
   * 收集源路径下所有支持文件，并为重复相对路径生成稳定去重名
   */
  public collect_source_file_entries(source_paths: string[]): ProjectSourceFileEntry[] {
    const normalized_source_paths = this.normalize_source_paths(source_paths);
    const candidates: ProjectSourceFileEntry[] = [];
    const seen_file_keys = new Set<string>();
    for (const source_path of normalized_source_paths) {
      for (const source_file of this.collect_source_files(source_path)) {
        const file_key = this.build_path_identity_key(source_file);
        if (seen_file_keys.has(file_key)) {
          continue;
        }
        seen_file_keys.add(file_key);
        candidates.push({
          source_path: source_file,
          rel_path: this.build_source_relative_path(source_path, source_file),
        });
      }
    }
    const used_rel_paths = new Set<string>();
    return candidates.map((entry, index) => ({
      source_path: entry.source_path,
      rel_path: this.build_unique_relative_path(entry.rel_path, used_rel_paths, index),
    }));
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
      const format_id = PROJECT_SOURCE_FORMAT_ID_BY_EXTENSION.get(
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
    for (const raw_path of source_paths) {
      const source_path = String(raw_path ?? "").trim();
      if (source_path === "") {
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
   * 写回时逐格式处理，同一批 items 由各格式自行筛选自己的 file_type
   */
  public async write_items(items: Item[], context: FileFormatWriteContext): Promise<void> {
    const { paths, asset_reader } = context;
    await this.txt.write_to_path(items, paths);
    await this.md.write_to_path(items, paths, asset_reader);
    await this.ass.write_to_path(items, paths);
    await this.srt.write_to_path(items, paths);
    await this.kvjson.write_to_path(items, paths);
    await this.messagejson.write_to_path(items, paths);
    await this.xlsx.write_to_path(items, paths);
    await this.wolfxlsx.write_to_path(items, paths, asset_reader);
    await this.trans.write_to_path(items, paths, asset_reader);
    await this.renpy.write_to_path(items, paths, asset_reader);
    await this.epub.write_to_path(items, paths, asset_reader);
    await this.pdf.write_to_path(items, context);
  }

  /**
   * 预览文件类型取第一个有效条目，空文件或无法识别时返回 NONE
   */
  public pick_file_type(items: Item[]): ItemFileType {
    for (const item of items) {
      if (item.file_type !== "NONE") {
        return item.file_type;
      }
    }
    return "NONE";
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
