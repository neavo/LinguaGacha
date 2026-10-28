import type { Item, ProjectItemPersistentRecord } from "../../domain/item";
import type { SourceFileFailure } from "./source-file-parse-failure-reporter";
import { FileFormatService } from "./file-format-service";
import type { PDFDocument } from "../../shared/pdf";
import type { PreparedRead, ProjectFileType, SourceFileParseWarning } from "./file-format-types";
import { is_app_error } from "../../shared/error";

export type SourceFileParseCommand = import("./source-discovery").DiscoveredSource;

/** 已取得原稿的资产。外部来源由准备流程交付，重置读取工程保存的原稿。 */
export type SourceFileAsset = Readonly<{
  source_path: string; // 失败诊断定位，重置时即资产路径。
  rel_path: string;
  file_type?: string | undefined;
  content: Uint8Array;
  additional_files: readonly string[];
  read?: PreparedRead; // 准备阶段已解析同一快照时直接消费。
}>;

/** 取得原稿即形成可提交草稿，解析失败时条目为空。 */
export type SourceFileParsedDraft = {
  rel_path: string;
  file_type: ProjectFileType; // 解析器提供文件身份，零条目字幕也保留类型
  game_engine?: string; // TRANS 原稿的引擎上下文，供文本规则计算。
  additional_files: readonly string[]; // 游戏容器中的附加原稿成员，其他格式为空。
  content: Uint8Array;
  pdf_document: PDFDocument | null; // PDF 独立文档，文本格式为空
  parsed_items: Item[]; // 格式解析器已补齐的条目草稿，身份由工程入口分配
};

/** 单个资产的解析结果，诊断由操作拥有者统一记录。 */
export type SourceFileAssetParse = {
  draft: SourceFileParsedDraft;
  warnings: SourceFileParseWarning[];
  failure: SourceFileFailure | null; // 整个资产解析失败，草稿仍以零条目提交。
};

export type SourceFileParseResult = {
  directory_changes: string[];
  warnings: SourceFileParseWarning[]; // 本次解析的局部遗漏，仅供后端操作日志使用。
  file_drafts: SourceFileParsedDraft[]; // 每个取得原稿的来源一份，解析失败时条目为空。
  failures: SourceFileFailure[]; // 来源准备或提取失败，仅供日志使用，可靠原稿可同时存在。
};

export type SourceFileProjectDraft = {
  directory_changes: string[];
  warnings: SourceFileParseWarning[]; // 本次解析的局部遗漏，仅供后端操作日志使用。
  files: Array<{
    rel_path: string;
    file_type: ProjectFileType;
    sort_index: number;
    additional_files: readonly string[];
    content: Uint8Array;
    pdf_document: PDFDocument | null;
  }>; // 资产写入清单，文件类型同时用于新建预过滤。
  items: ProjectItemPersistentRecord[]; // 已分配临时 id、file_path 和 file_type
  failures: SourceFileFailure[];
};

/**
 * 源文件解析流水线消费已发现来源或已保存原稿，统一解析和归集失败。
 */
export class SourceFileParsePipeline {
  private readonly format_service: FileFormatService; // 来源准备和格式分发共用本次设置快照。

  /**
   * 构造时固定格式服务，保证一次解析使用同一设置快照。
   */
  public constructor(format_service: FileFormatService) {
    this.format_service = format_service;
  }

  /**
   * 新建工程按来源顺序分配条目身份并准备资产写入。
   */
  public async build_project_draft(
    entries: readonly SourceFileParseCommand[],
    signal?: AbortSignal,
  ): Promise<SourceFileProjectDraft> {
    const parse_result = await this.parse_source_entries(entries, signal);
    const files: SourceFileProjectDraft["files"] = [];
    const items: SourceFileProjectDraft["items"] = [];
    let next_item_id = 1; // 由后端顺序分配，避免 renderer 伪造数据库主键

    for (const [sort_index, draft] of parse_result.file_drafts.entries()) {
      files.push({
        rel_path: draft.rel_path,
        file_type: draft.file_type,
        sort_index,
        pdf_document: draft.pdf_document,
        content: draft.content,
        additional_files: draft.additional_files,
      });
      for (const parsed_item of draft.parsed_items) {
        const item_payload = {
          ...parsed_item,
          id: next_item_id,
          file_path: parsed_item.file_path || draft.rel_path,
        };
        items.push(item_payload);
        next_item_id += 1;
      }
    }

    return {
      directory_changes: parse_result.directory_changes,
      files,
      items,
      failures: parse_result.failures,
      warnings: parse_result.warnings,
    };
  }

  /**
   * 项目文件导入消费已准备的路径和格式身份；解析失败不阻断同批成功文件。
   */
  public async parse_import_commands(
    commands: SourceFileParseCommand[],
    signal?: AbortSignal,
  ): Promise<SourceFileParseResult> {
    // 异步解析前固定目标路径，避免调用方修改命令影响本次导入。
    return this.parse_source_entries(
      commands.map((command) => ({
        source: command.source,
        source_path: command.source_path,
        file_type: command.file_type,
        rel_path: command.rel_path,
      })),
      signal,
    );
  }

  /**
   * 新建、导入与重置共用的接纳规则：取得原稿即形成草稿，解析失败只清空条目。
   */
  public async parse_asset_draft(
    asset: SourceFileAsset,
    signal?: AbortSignal,
  ): Promise<SourceFileAssetParse> {
    const draft: SourceFileParsedDraft = {
      rel_path: asset.rel_path,
      file_type: (asset.file_type ?? "NONE") as ProjectFileType,
      content: asset.content,
      additional_files: asset.additional_files,
      pdf_document: null,
      parsed_items: [],
    };
    try {
      signal?.throwIfAborted();
      const { read } = asset;
      if (read && !read.ok) throw read.error;
      const parsed = read
        ? read.result
        : await this.format_service.parse_asset(
            asset.rel_path,
            asset.content,
            asset.file_type,
            asset.additional_files,
            signal,
          );
      if (parsed.kind === "pdf") {
        draft.file_type = "PDF";
        draft.pdf_document = parsed.document;
      } else {
        draft.file_type = parsed.file_type;
        draft.parsed_items = parsed.items;
        if (parsed.game_engine !== undefined) draft.game_engine = parsed.game_engine;
      }
      return {
        draft,
        warnings: parsed.kind === "items" ? (parsed.warnings ?? []) : [],
        failure: null,
      };
    } catch (error) {
      if (signal?.aborted) throw error; // 取消不能归为单个资产的解析失败。
      return {
        draft,
        warnings: [],
        failure: { source_path: asset.source_path, rel_path: asset.rel_path, error },
      };
    }
  }

  /**
   * 准备外部来源取得原稿，再交给共用的资产解析。未取得原稿的来源只记录失败。
   */
  private async parse_source_entries(
    entries: readonly SourceFileParseCommand[],
    signal?: AbortSignal,
  ): Promise<SourceFileParseResult> {
    const file_drafts: SourceFileParsedDraft[] = [];
    const failures: SourceFileFailure[] = [];
    const warnings: SourceFileParseWarning[] = [];
    const directory_changes: string[] = [];
    for (const entry of entries) {
      signal?.throwIfAborted();
      let prepared;
      try {
        prepared = await this.format_service.prepare_source(entry, signal);
      } catch (error) {
        if (signal?.aborted) throw error; // 保留取消收尾中的恢复失败及恢复材料位置。
        if (is_app_error(error) && error.public_details?.directory_changed === true)
          directory_changes.push(entry.source_path);
        failures.push({ source_path: entry.source_path, rel_path: entry.rel_path, error });
        continue;
      }
      if (prepared.directory_changed) directory_changes.push(entry.source_path);
      for (const diagnostic of prepared.diagnostics)
        warnings.push({
          code: "source_preparation_failed",
          rel_path: entry.rel_path,
          ...(diagnostic.member === undefined ? {} : { internal_file_path: diagnostic.member }),
          stage: diagnostic.stage,
          error: diagnostic.error,
          diagnostics: [{ message: diagnostic.error.message, line: null, column: null }],
        });
      const parsed = await this.parse_asset_draft(
        {
          source_path: entry.source_path,
          rel_path: entry.rel_path,
          file_type: entry.file_type,
          content: prepared.content,
          additional_files: prepared.additional_files,
          ...(prepared.read && { read: prepared.read }),
        },
        signal,
      );
      file_drafts.push(parsed.draft);
      warnings.push(...parsed.warnings);
      if (parsed.failure) failures.push(parsed.failure);
    }
    return { file_drafts, failures, warnings, directory_changes };
  }
}
