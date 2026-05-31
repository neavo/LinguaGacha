import path from "node:path";

import type { ApiJsonValue } from "../api/api-types";
import { Item, type ItemFileType } from "../../domain/item";
import { NativeFs, default_native_fs } from "../../native/native-fs";
import type { SourceFileParseFailureRecord } from "../../shared/source-file-parse-failure";
import { build_source_file_parse_failure } from "./source-file-parse-failure-reporter";
import { FileFormatService } from "../file/file-format-service";
import type { ParsedFilePreview, ProjectSourceFileEntry } from "../file/formats/file-format-shared";

export type SourceFileParseCommand = {
  source_path: string; // 用户选择的真实文件路径，只允许解析流水线读取
  rel_path: string; // 工程或工作台内的目标相对路径
};

export type SourceFileParsedDraft = SourceFileParseCommand & {
  file_type: ItemFileType; // 只来自格式解析结果，不由调用方猜测
  parsed_items: Array<Record<string, ApiJsonValue>>; // 已过 Item JSON 边界的公开草稿
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
    file_type: ItemFileType;
    sort_index: number;
  }>; // files 是项目文件 section 和 asset 写库共同使用的草稿
  items: Array<Record<string, ApiJsonValue>>; // 已分配临时 id、file_path 和 file_type
  file_state: Record<string, Record<string, ApiJsonValue>>; // 供预过滤算法消费
  failed_files: SourceFileParseFailureRecord[];
};

export type WorkbenchFilePreviewParseResult = {
  files: Array<Record<string, ApiJsonValue>>;
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
   * 工作台导入提交只消费源路径和目标路径；解析失败不阻断同批成功文件。
   */
  public async parse_import_commands(
    commands: SourceFileParseCommand[],
  ): Promise<SourceFileParseResult> {
    return this.parse_source_entries(
      commands.map((command) => ({
        source_path: command.source_path,
        rel_path: command.rel_path,
      })),
    );
  }

  /**
   * 工作台预览同时支持新增目录展开和替换单文件路径计算。
   */
  public async parse_workbench_preview(args: {
    source_paths: string[];
    current_rel_path?: string;
  }): Promise<WorkbenchFilePreviewParseResult> {
    if (args.current_rel_path !== undefined) {
      return this.parse_workbench_replace_preview(args.source_paths, args.current_rel_path);
    }

    const parse_result = await this.parse_source_entries(
      this.format_service.collect_source_file_entries(args.source_paths),
    );
    return {
      files: parse_result.file_drafts.map((draft) => ({
        source_path: draft.source_path,
        target_rel_path: draft.rel_path,
        file_type: draft.file_type,
        parsed_items: draft.parsed_items,
      })),
      failed_files: parse_result.failed_files,
    };
  }

  /**
   * 解析一组已确定目标相对路径的源文件，返回成功草稿和失败明细。
   */
  private async parse_source_entries(
    entries: ProjectSourceFileEntry[],
  ): Promise<SourceFileParseResult> {
    const file_drafts: SourceFileParsedDraft[] = [];
    const failed_files: SourceFileParseFailureRecord[] = [];
    for (const entry of entries) {
      try {
        const parsed_items = await this.format_service.parse_asset(
          entry.rel_path,
          this.native_fs.read_file(entry.source_path),
        );
        file_drafts.push({
          source_path: entry.source_path,
          rel_path: entry.rel_path,
          file_type: this.format_service.pick_file_type(parsed_items),
          parsed_items: parsed_items.map((item) => Item.from_json(item).to_json()),
        });
      } catch (error) {
        failed_files.push(this.build_failure(entry, error));
      }
    }
    return { file_drafts, failed_files };
  }

  /**
   * 工作台替换预览保留格式服务的目标路径规则，不重新实现目录拼接。
   */
  private async parse_workbench_replace_preview(
    source_paths: string[],
    current_rel_path: string,
  ): Promise<WorkbenchFilePreviewParseResult> {
    const files: Array<Record<string, ApiJsonValue>> = [];
    const failed_files: SourceFileParseFailureRecord[] = [];
    for (const source_path of this.collect_supported_single_files(source_paths)) {
      try {
        const preview = await this.format_service.parse_file_preview(source_path, current_rel_path);
        files.push(this.build_preview_payload(source_path, preview));
      } catch (error) {
        failed_files.push(
          this.build_failure(
            {
              source_path,
              rel_path: path.basename(source_path),
            },
            error,
          ),
        );
      }
    }
    return { files, failed_files };
  }

  /**
   * 替换文件入口只接受显式文件路径，不展开目录，保持旧文件替换意图明确。
   */
  private collect_supported_single_files(source_paths: string[]): string[] {
    return this.format_service
      .normalize_source_paths(source_paths)
      .filter((source_path) => this.format_service.is_supported_file(source_path));
  }

  /**
   * 工作台预览响应保留 source_path，其他字段来自格式服务公开预览结果。
   */
  private build_preview_payload(
    source_path: string,
    preview: ParsedFilePreview,
  ): Record<string, ApiJsonValue> {
    return {
      source_path,
      target_rel_path: preview.target_rel_path,
      file_type: preview.file_type,
      parsed_items: preview.parsed_items as unknown as ApiJsonValue,
    };
  }

  /**
   * 失败记录统一走 reporter，保证 Toast、日志和错误 details 使用同一语义。
   */
  private build_failure(
    entry: ProjectSourceFileEntry,
    error: unknown,
  ): SourceFileParseFailureRecord {
    return build_source_file_parse_failure({
      source_path: entry.source_path,
      rel_path: entry.rel_path,
      error,
    });
  }
}
