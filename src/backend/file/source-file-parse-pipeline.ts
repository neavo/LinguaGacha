import type { Item, ProjectItemPersistentRecord } from "../../domain/item";
import type { SourceFileParseFailureRecord } from "../../shared/source-file-parse-failure";
import { build_source_file_parse_failure } from "./source-file-parse-failure-reporter";
import { FileFormatService } from "./file-format-service";
import type { PDFDocument } from "../../shared/pdf";
import type { ProjectFileType, SourceFileParseWarning } from "./file-format-types";

export type SourceFileParseCommand = import("./source-discovery").DiscoveredSource;

export type SourceFileParsedDraft = SourceFileParseCommand & {
  file_type: ProjectFileType; // 解析器提供文件身份，零条目字幕也保留类型
  game_engine?: string; // 导入继承按引擎区分相同正文的文本规则身份。
  additional_files: readonly string[]; // 游戏容器中的附加原稿成员，其他格式为空。
  content: Uint8Array;
  pdf_document: PDFDocument | null; // PDF 独立文档，文本格式为空
  parsed_items: Item[]; // 格式解析器已补齐的条目草稿，身份由工程入口分配
};

export type SourceFileParseResult = {
  warnings: SourceFileParseWarning[]; // 本次解析的局部遗漏，仅供后端操作日志使用。
  file_drafts: SourceFileParsedDraft[]; // 只包含解析成功且可继续提交的文件
  failed_files: SourceFileParseFailureRecord[]; // 只包含支持格式候选的读取或解析失败
};

export type SourceFileProjectDraft = {
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
  failed_files: SourceFileParseFailureRecord[];
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
      files,
      items,
      failed_files: parse_result.failed_files,
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
   * 解析一组已确定目标相对路径的源文件，返回成功草稿和失败明细。
   */
  private async parse_source_entries(
    entries: readonly SourceFileParseCommand[],
    signal?: AbortSignal,
  ): Promise<SourceFileParseResult> {
    const file_drafts: SourceFileParsedDraft[] = [];
    const failed_files: SourceFileParseFailureRecord[] = [];
    const warnings: SourceFileParseWarning[] = [];
    for (const entry of entries) {
      signal?.throwIfAborted();
      const file_type = entry.file_type;
      try {
        const prepared = await this.format_service.prepare_source(entry, signal);
        signal?.throwIfAborted();
        const { content } = prepared;
        const parsed = await this.format_service.parse_asset(
          entry.rel_path,
          content,
          file_type,
          prepared.additional_files,
        );
        if (parsed.kind === "items") warnings.push(...(parsed.warnings ?? []));
        file_drafts.push({
          ...(parsed.kind === "items" && parsed.game_engine !== undefined
            ? { game_engine: parsed.game_engine }
            : {}),
          content,
          additional_files: prepared.additional_files,
          source: entry.source,
          source_path: entry.source_path,
          rel_path: entry.rel_path,
          file_type: parsed.kind === "pdf" ? "PDF" : parsed.file_type,
          pdf_document: parsed.kind === "pdf" ? parsed.document : null,
          parsed_items: parsed.kind === "items" ? parsed.items : [],
        });
      } catch (error) {
        if (signal?.aborted) throw error; // 保留取消收尾中的恢复失败及恢复材料位置。
        failed_files.push(build_source_file_parse_failure({ ...entry, error }));
      }
    }
    return { file_drafts, failed_files, warnings };
  }
}
