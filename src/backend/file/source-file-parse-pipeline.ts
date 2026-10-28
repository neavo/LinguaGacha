import type { Item, ProjectItemPersistentRecord } from "../../domain/item";
import type { SourceFileFailure } from "./source-file-parse-failure-reporter";
import { FileFormatService } from "./file-format-service";
import type { PDFDocument } from "../../shared/pdf";
import type { ProjectFileType, SourceFileParseWarning } from "./file-format-types";
import { is_app_error } from "../../shared/error";

export type SourceFileParseCommand = import("./source-discovery").DiscoveredSource;

export type SourceFileParsedDraft = SourceFileParseCommand & {
  source_complete: boolean; // 原稿遗漏会阻止整组替换，可靠成员仍允许新增。
  extraction_complete: boolean; // 原稿可靠性由准备边界保证，替换还要求提取完整。
  file_type: ProjectFileType; // 解析器提供文件身份，零条目字幕也保留类型
  game_engine?: string; // TRANS 原稿的引擎上下文，供文本规则计算。
  additional_files: readonly string[]; // 游戏容器中的附加原稿成员，其他格式为空。
  content: Uint8Array;
  pdf_document: PDFDocument | null; // PDF 独立文档，文本格式为空
  parsed_items: Item[]; // 格式解析器已补齐的条目草稿，身份由工程入口分配
};

export type SourceFileParseResult = {
  directory_changes: string[];
  warnings: SourceFileParseWarning[]; // 本次解析的局部遗漏，仅供后端操作日志使用。
  file_drafts: SourceFileParsedDraft[]; // 包含可靠原稿，解析失败时仍可作为新增资产保存。
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
 * 源文件解析流水线消费已发现来源，统一准备、解析和归集失败。
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
   * 固化已确定来源，再将提取结果附到同一资产草稿。
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
      const file_type = entry.file_type;
      try {
        const prepared = await this.format_service.prepare_source(entry, signal);
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
        signal?.throwIfAborted();
        const { content } = prepared;
        const draft: SourceFileParsedDraft = {
          ...entry,
          file_type: (file_type ?? "NONE") as ProjectFileType,
          content,
          additional_files: prepared.additional_files,
          pdf_document: null,
          parsed_items: [],
          extraction_complete: false,
          source_complete: prepared.source_complete,
        };
        file_drafts.push(draft);
        // 准备阶段已解析时直接消费；失败沿用解析失败通道，可靠原稿已在上方登记。
        const { read } = prepared;
        if (read && !read.ok) throw read.error;
        const parsed = read
          ? read.result
          : await this.format_service.parse_asset(
              entry.rel_path,
              content,
              file_type,
              prepared.additional_files,
              signal,
            );
        if (parsed.kind === "items") warnings.push(...(parsed.warnings ?? []));
        Object.assign(draft, {
          ...(parsed.kind === "items" && parsed.game_engine !== undefined
            ? { game_engine: parsed.game_engine }
            : {}),
          file_type: parsed.kind === "pdf" ? "PDF" : parsed.file_type,
          pdf_document: parsed.kind === "pdf" ? parsed.document : null,
          parsed_items: parsed.kind === "items" ? parsed.items : [],
          extraction_complete: parsed.kind === "pdf" || parsed.extraction_complete !== false,
        });
      } catch (error) {
        if (signal?.aborted) throw error; // 保留取消收尾中的恢复失败及恢复材料位置。
        if (is_app_error(error) && error.public_details?.directory_changed === true)
          directory_changes.push(entry.source_path);
        failures.push({ source_path: entry.source_path, rel_path: entry.rel_path, error });
      }
    }
    return { file_drafts, failures, warnings, directory_changes };
  }
}
