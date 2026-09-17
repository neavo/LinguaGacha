import path from "node:path";

import type { JsonRecord } from "../../domain/json";
import { Item } from "../../domain/item";
import { NativeFs, default_native_fs } from "../../native/native-fs";
import type { SourceFileParseFailureRecord } from "../../shared/source-file-parse-failure";
import { build_source_file_parse_failure } from "./source-file-parse-failure-reporter";
import { FileFormatService } from "../file/file-format-service";
import type { PDFDocument } from "../../shared/pdf";
import type { ProjectSourceFileEntry, ProjectFileType } from "../file/formats/file-format-shared";

export type SourceFileParseCommand = {
  source_path: string; // 用户选择的真实文件路径，只允许解析流水线读取
  rel_path: string; // 项目内的目标相对路径
};

export type SourceFileParsedDraft = SourceFileParseCommand & {
  file_type: ProjectFileType; // 普通格式取首个 Item，零条目为 NONE；PDF 使用文档身份
  pdf_document: PDFDocument | null; // PDF 独立文档，文本格式为空
  parsed_items: Array<JsonRecord>; // 已过 Item JSON 边界的公开草稿
};

export type SourceFileParseResult = {
  file_drafts: SourceFileParsedDraft[]; // 只包含解析成功且可继续提交的文件
  failed_files: SourceFileParseFailureRecord[]; // 只包含支持格式候选的读取或解析失败
};

export type SourceFileProjectDraft = {
  source_paths: string[]; // 格式服务归一后的用户输入路径
  files: Array<{
    rel_path: string;
    source_path: string;
    file_type: ProjectFileType;
    sort_index: number;
    pdf_document: PDFDocument | null;
  }>; // files 是项目文件 section 和 asset 写库共同使用的草稿
  items: Array<JsonRecord>; // 已分配临时 id、file_path 和 file_type
  file_state: Record<string, JsonRecord>; // 供预过滤算法消费
  failed_files: SourceFileParseFailureRecord[];
};

export type ProjectFilePreviewParseResult = {
  files: Array<JsonRecord>;
  failed_files: SourceFileParseFailureRecord[];
};

/**
 * 源文件解析流水线统一承载目录展开、文件读取、格式解析和失败明细归一。
 */
export class SourceFileParsePipeline {
  private readonly format_service: FileFormatService; // 格式分发和相对路径分配的唯一入口
  private readonly native_fs: NativeFs; // 读取用户源文件 bytes 的唯一文件系统门面

  /**
   * 构造时固定格式服务与文件系统，保证一次解析使用同一设置快照。
   */
  public constructor(format_service: FileFormatService, native_fs: NativeFs = default_native_fs) {
    this.format_service = format_service;
    this.native_fs = native_fs;
  }

  /**
   * 新建工程和新建预览共用同一份源路径归一与解析草稿。
   */
  public async build_project_draft(source_paths: string[]): Promise<SourceFileProjectDraft> {
    const normalized_source_paths = this.format_service.normalize_source_paths(source_paths);
    const parse_result = await this.parse_source_entries(
      this.format_service.collect_source_file_entries(normalized_source_paths),
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
          file_path: String(parsed_item["file_path"] ?? draft.rel_path) || draft.rel_path,
          file_type: String(parsed_item["file_type"] ?? "NONE") || "NONE",
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
    };
  }

  /**
   * 项目文件导入只消费源路径和目标路径；解析失败不阻断同批成功文件。
   */
  public async parse_import_commands(
    commands: SourceFileParseCommand[],
  ): Promise<SourceFileParseResult> {
    // 异步解析前固定目标路径，避免调用方修改命令影响本次导入。
    return this.parse_source_entries(
      commands.map((command) => ({
        source_path: command.source_path,
        rel_path: command.rel_path,
      })),
    );
  }

  /**
   * 项目文件预览同时支持新增目录展开和替换单文件路径计算。
   */
  public async parse_project_file_preview(args: {
    source_paths: string[];
    current_rel_path?: string;
  }): Promise<ProjectFilePreviewParseResult> {
    const current_rel_path = args.current_rel_path;
    let entries: ProjectSourceFileEntry[];
    if (current_rel_path === undefined) {
      entries = this.format_service.collect_source_file_entries(args.source_paths);
    } else {
      // 替换保留工程内父目录，失败明细则只显示所选源文件名。
      const parent = path.dirname(current_rel_path);
      entries = this.format_service
        .normalize_source_paths(args.source_paths)
        .filter((source_path) => this.format_service.is_supported_file(source_path))
        .map((source_path) => ({
          source_path,
          rel_path:
            current_rel_path === "" || parent === "."
              ? path.basename(source_path)
              : path.join(parent, path.basename(source_path)),
        }));
    }
    const parse_result = await this.parse_source_entries(entries);
    return {
      files: parse_result.file_drafts.map((draft) => ({
        source_path: draft.source_path,
        target_rel_path: draft.rel_path,
        file_type: draft.file_type,
        parsed_items: draft.parsed_items,
      })),
      failed_files:
        current_rel_path === undefined
          ? parse_result.failed_files
          : parse_result.failed_files.map((failure) => ({
              ...failure,
              rel_path: path.basename(failure.source_path),
            })),
    };
  }

  /**
   * 解析一组已确定目标相对路径的源文件，返回成功草稿和失败明细。
   */
  private async parse_source_entries(
    entries: readonly ProjectSourceFileEntry[],
  ): Promise<SourceFileParseResult> {
    const file_drafts: SourceFileParsedDraft[] = [];
    const failed_files: SourceFileParseFailureRecord[] = [];
    for (const entry of entries) {
      try {
        const parsed = await this.format_service.parse_asset(
          entry.rel_path,
          this.native_fs.read_file(entry.source_path),
        );
        file_drafts.push({
          source_path: entry.source_path,
          rel_path: entry.rel_path,
          file_type: parsed.kind === "pdf" ? "PDF" : (parsed.items[0]?.file_type ?? "NONE"),
          pdf_document: parsed.kind === "pdf" ? parsed.document : null,
          parsed_items:
            parsed.kind === "items"
              ? parsed.items.map((item) => Item.from_json(item).to_json())
              : [],
        });
      } catch (error) {
        failed_files.push(build_source_file_parse_failure({ ...entry, error }));
      }
    }
    return { file_drafts, failed_files };
  }
}
