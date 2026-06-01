import type { ApiJsonValue } from "../api/api-types";
import { AppSettingService } from "../app/app-setting-service";
import { FileFormatService } from "../file/file-format-service";
import { normalize_setting_snapshot } from "../../domain/setting";
import { NativeFs, default_native_fs } from "../../native/native-fs";
import type { LogManager } from "../log/log-manager";
import { SourceFileParsePipeline } from "./source-file-parse-pipeline";
import { log_source_file_parse_failures } from "./source-file-parse-failure-reporter";
import type { SourceFileParseFailureRecord } from "../../shared/source-file-parse-failure";
import { create_text_resolver, resolve_i18n_locale, type TextResolver } from "../../shared/i18n";

type JsonRecord = Record<string, ApiJsonValue>;

/**
 * 文件解析预演服务；公开源文件草稿只由 Backend 文件域解析
 */
export class FilePreviewService {
  private readonly app_setting_service: AppSettingService; // 提供当前语言和导出配置快照
  private readonly log_manager: Pick<LogManager, "warning"> | null; // 只记录批量解析失败明细，不影响预览响应
  private readonly native_fs: NativeFs; // 统一读取用户选择的源文件

  /**
   * 预演服务只编排配置和 格式处理器，不直接写数据库
   */
  public constructor(
    app_setting_service: AppSettingService,
    log_manager: Pick<LogManager, "warning"> | null = null,
    native_fs: NativeFs = default_native_fs,
  ) {
    this.app_setting_service = app_setting_service;
    this.log_manager = log_manager;
    this.native_fs = native_fs;
  }

  /**
   * 工作台单文件预解析返回成功与失败清单，避免批量输入失败被静默吞掉
   */
  public async parse_workbench_file(request: JsonRecord): Promise<JsonRecord> {
    const source_paths = this.normalize_string_list(request["source_paths"]);
    const current_rel_path =
      typeof request["current_rel_path"] === "string" ? request["current_rel_path"] : undefined;
    const pipeline = this.create_parse_pipeline();
    const result = await pipeline.parse_workbench_preview({
      source_paths,
      current_rel_path,
    });
    this.log_parse_failures(result.failed_files);
    return {
      files: result.files as unknown as ApiJsonValue,
      failed_files: result.failed_files as unknown as ApiJsonValue,
    };
  }

  /**
   * 新建工程预览统一分配临时 item id，所有公开文件格式都走 文件域
   */
  public async build_create_preview(request: JsonRecord): Promise<JsonRecord> {
    const source_paths = this.normalize_string_list(request["source_paths"]);
    const draft = await this.create_parse_pipeline().build_project_draft(source_paths);
    this.log_parse_failures(draft.failed_files);
    return {
      draft: {
        source_paths: draft.source_paths,
        files: draft.files,
        items: draft.items,
        section_revisions: { files: 0, items: 0, analysis: 0 },
      },
      failed_files: draft.failed_files as unknown as ApiJsonValue,
    };
  }

  /**
   * 解析流水线固定当前设置快照，避免同一批预览中语言配置前后漂移。
   */
  private create_parse_pipeline(): SourceFileParsePipeline {
    return new SourceFileParsePipeline(this.create_format_service(), this.native_fs);
  }

  /**
   * 批量解析失败统一写日志；日志内容只保留逐文件原因。
   */
  private log_parse_failures(failed_files: SourceFileParseFailureRecord[]): void {
    log_source_file_parse_failures({
      failures: failed_files,
      log_manager: this.log_manager,
      source: "file-preview",
      text: this.create_text_resolver(),
    });
  }

  /**
   * 每次按当前配置创建格式服务，避免设置页改动后预演仍使用旧语言
   */
  private create_format_service(): FileFormatService {
    const config = normalize_setting_snapshot(this.app_setting_service.read_setting());
    return new FileFormatService(
      {
        source_language: config.source_language,
        target_language: config.target_language,
        app_language: config.app_language,
        deduplication_in_bilingual: config.deduplication_in_bilingual,
        write_translated_name_fields_to_file: config.write_translated_name_fields_to_file,
      },
      this.native_fs,
    );
  }

  /**
   * 日志文案跟随当前应用语言，和 API 错误文案保持同一入口。
   */
  private create_text_resolver(): TextResolver {
    const config = normalize_setting_snapshot(this.app_setting_service.read_setting());
    return create_text_resolver(resolve_i18n_locale(config.app_language));
  }

  /**
   * API 入参只接受非空字符串路径，其他值直接丢弃
   */
  private normalize_string_list(value: ApiJsonValue | undefined): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "")
      : [];
  }
}
