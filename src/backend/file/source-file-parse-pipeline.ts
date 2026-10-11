import { JsonTool } from "../../shared/utils/json-tool";
import { read_json_record } from "../../domain/json";
import type { ProjectFileRecord } from "../project/project-file-records";

import type { Item, ProjectItemPersistentRecord } from "../../domain/item";
import type { SourceFileParseFailureRecord } from "../../shared/source-file-parse-failure";
import { build_source_file_parse_failure } from "./source-file-parse-failure-reporter";
import { FileFormatService } from "./file-format-service";
import type { PDFDocument } from "../../shared/pdf";
import type { ProjectFileType, SourceFileParseWarning } from "./file-format-shared";

export type SourceFileParseCommand = {
  file_type: string | undefined; // 新来源可由内容细分类型，已有资产必须传入保存的身份
  source_path: string; // 用户选择的真实来源路径，由格式服务准备固化原稿
  rel_path: string; // 项目内的目标相对路径
};

export type SourceFileParsedDraft = SourceFileParseCommand & {
  file_type: ProjectFileType; // 解析器提供文件身份，零条目字幕也保留类型
  game_engine?: string;
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
  source_paths: string[]; // 格式服务归一后的用户输入路径
  files: Array<{
    rel_path: string;
    source_path: string;
    file_type: ProjectFileType;
    sort_index: number;
    content: Uint8Array;
    pdf_document: PDFDocument | null;
  }>; // files 是项目文件 section 和 asset 写库共同使用的草稿
  items: ProjectItemPersistentRecord[]; // 已分配临时 id、file_path 和 file_type
  file_state: Record<string, ProjectFileRecord>; // 供预过滤算法消费
  failed_files: SourceFileParseFailureRecord[];
};

/**
 * 源文件解析流水线统一承载目录展开、文件读取、格式解析和失败明细归一。
 */
export class SourceFileParsePipeline {
  private readonly format_service: FileFormatService; // 格式分发和相对路径分配的唯一入口

  /**
   * 构造时固定格式服务，保证一次解析使用同一设置快照。
   */
  public constructor(format_service: FileFormatService) {
    this.format_service = format_service;
  }

  /**
   * 新建工程和新建预览共用同一份源路径归一与解析草稿。
   */
  public async build_project_draft(source_paths: string[]): Promise<SourceFileProjectDraft> {
    const normalized_source_paths = this.format_service.normalize_source_paths(source_paths);
    const parse_result = await this.parse_source_entries(
      this.format_service
        .assign_source_file_paths(
          this.format_service.collect_source_file_entries(normalized_source_paths),
        )
        .map((entry) => ({ ...entry, file_type: entry.file_type })),
    );
    const files: SourceFileProjectDraft["files"] = [];
    const items: SourceFileProjectDraft["items"] = [];
    const file_state: SourceFileProjectDraft["file_state"] = {};
    let next_item_id = 1; // 由后端顺序分配，避免 renderer 伪造数据库主键

    for (const [sort_index, draft] of parse_result.file_drafts.entries()) {
      files.push({
        rel_path: draft.rel_path,
        source_path: draft.source_path,
        file_type: draft.file_type,
        sort_index,
        pdf_document: draft.pdf_document,
        content: draft.content,
      });
      file_state[draft.rel_path] = {
        rel_path: draft.rel_path,
        file_type: draft.file_type,
        sort_index,
      };
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
      source_paths: normalized_source_paths,
      files,
      items,
      file_state,
      failed_files: parse_result.failed_files,
      warnings: parse_result.warnings,
    };
  }

  /**
   * 项目文件导入消费已准备的路径和格式身份；解析失败不阻断同批成功文件。
   */
  public async parse_import_commands(
    commands: SourceFileParseCommand[],
  ): Promise<SourceFileParseResult> {
    // 异步解析前固定目标路径，避免调用方修改命令影响本次导入。
    return this.parse_source_entries(
      commands.map((command) => ({
        source_path: command.source_path,
        file_type: command.file_type,
        rel_path: command.rel_path,
      })),
    );
  }

  /**
   * 解析一组已确定目标相对路径的源文件，返回成功草稿和失败明细。
   */
  private async parse_source_entries(
    entries: readonly SourceFileParseCommand[],
  ): Promise<SourceFileParseResult> {
    const file_drafts: SourceFileParsedDraft[] = [];
    const failed_files: SourceFileParseFailureRecord[] = [];
    const warnings: SourceFileParseWarning[] = [];
    for (const entry of entries) {
      const file_type = entry.file_type;
      try {
        const prepared = await this.format_service.prepare_source(
          entry.source_path,
          entry.rel_path,
          file_type,
        );
        const { content } = prepared;
        warnings.push(...prepared.warnings);
        const parsed = await this.format_service.parse_asset(entry.rel_path, content, file_type);
        if (parsed.kind === "items") warnings.push(...(parsed.warnings ?? []));
        file_drafts.push({
          ...(parsed.kind === "items" && parsed.file_type === "TRANS"
            ? {
                game_engine: String(
                  read_json_record(read_json_record(JsonTool.parseStrict(content))["project"])[
                    "gameEngine"
                  ] ?? "",
                ),
              }
            : {}),
          content,
          source_path: entry.source_path,
          rel_path: entry.rel_path,
          file_type: parsed.kind === "pdf" ? "PDF" : parsed.file_type,
          pdf_document: parsed.kind === "pdf" ? parsed.document : null,
          parsed_items: parsed.kind === "items" ? parsed.items : [],
        });
      } catch (error) {
        failed_files.push(build_source_file_parse_failure({ ...entry, error }));
      }
    }
    return { file_drafts, failed_files, warnings };
  }
}
