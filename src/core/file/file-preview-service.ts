import path from "node:path";

import type { ApiJsonValue } from "../api/api-types";
import { AppSettingService } from "../app/app-setting-service";
import { FileFormatService } from "./file-format-service";
import { Item } from "../../base/item";
import { normalize_setting_snapshot } from "../../base/setting";
import { NativeFs, default_native_fs } from "../../native/native-fs";
import type { LogManager } from "../log/log-manager";
import {
  build_source_file_parse_failure,
  log_source_file_parse_failures,
} from "./source-file-parse-failure-reporter";
import type { ProjectSourceFileEntry } from "./formats/file-format-shared";
import type { SourceFileParseFailureRecord } from "../../shared/source-file-parse-failure";
import { create_text_resolver, resolve_i18n_locale, type TextResolver } from "../../shared/i18n";

type JsonRecord = Record<string, ApiJsonValue>;

/**
 * 文件解析预演服务；公开源文件草稿只由 Core 文件域解析
 */
export class FilePreviewService {
  private readonly app_setting_service: AppSettingService; // app_setting_service 提供当前语言和导出配置快照
  private readonly log_manager: Pick<LogManager, "warning"> | null; // log_manager 只记录批量解析失败明细，不影响预览响应
  private readonly native_fs: NativeFs; // native_fs 统一读取用户选择的源文件

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
    const format_service = this.create_format_service();
    const files: JsonRecord[] = [];
    const failed_files: SourceFileParseFailureRecord[] = [];
    for (const source_file of this.collect_workbench_source_file_entries(
      format_service,
      source_paths,
      current_rel_path,
    )) {
      try {
        const parsed =
          current_rel_path === undefined
            ? await this.parse_source_file_entry(format_service, source_file)
            : await format_service.parse_file_preview(source_file.source_path, current_rel_path);
        files.push({ source_path: source_file.source_path, ...(parsed as unknown as JsonRecord) });
      } catch (error) {
        failed_files.push(
          build_source_file_parse_failure({
            source_path: source_file.source_path,
            rel_path: source_file.rel_path,
            error,
          }),
        );
      }
    }
    this.log_parse_failures(failed_files);
    return {
      files: files as unknown as ApiJsonValue,
      failed_files: failed_files as unknown as ApiJsonValue,
    };
  }

  /**
   * 新建工程预览统一分配临时 item id，所有公开文件格式都走 文件域
   */
  public async build_create_preview(request: JsonRecord): Promise<JsonRecord> {
    const source_paths = this.normalize_string_list(request["source_paths"]);
    const format_service = this.create_format_service();
    const effective_source_paths = format_service.normalize_source_paths(source_paths);
    const source_files = format_service.collect_source_file_entries(effective_source_paths);
    const files: JsonRecord[] = [];
    const failed_files: SourceFileParseFailureRecord[] = [];
    const items: JsonRecord[] = [];
    let next_item_id = 1;
    let next_sort_index = 0;
    for (const source_file of source_files) {
      let parsed_items: Item[];
      try {
        parsed_items = await format_service.parse_asset(
          source_file.rel_path,
          this.native_fs.read_file(source_file.source_path),
        );
      } catch (error) {
        failed_files.push(
          build_source_file_parse_failure({
            source_path: source_file.source_path,
            rel_path: source_file.rel_path,
            error,
          }),
        );
        continue;
      }
      let file_type = "NONE";
      for (const item of parsed_items) {
        const payload = Item.from_json(item).to_json();
        payload["id"] = next_item_id;
        payload["file_path"] =
          String(payload["file_path"] ?? source_file.rel_path) || source_file.rel_path;
        payload["file_type"] = String(payload["file_type"] ?? "NONE") || "NONE";
        file_type = String(payload["file_type"] ?? "NONE");
        items.push(payload);
        next_item_id += 1;
      }
      files.push({
        rel_path: source_file.rel_path,
        file_type,
        sort_index: next_sort_index,
        source_path: source_file.source_path,
      });
      next_sort_index += 1;
    }
    this.log_parse_failures(failed_files);
    return {
      draft: {
        source_paths: effective_source_paths,
        files,
        items,
        section_revisions: { files: 0, items: 0, analysis: 0 },
      },
      failed_files: failed_files as unknown as ApiJsonValue,
    };
  }

  /**
   * 工作台新增文件时展开目录；替换预览保留单文件目标路径计算语义。
   */
  private collect_workbench_source_file_entries(
    format_service: FileFormatService,
    source_paths: string[],
    current_rel_path: string | undefined,
  ): ProjectSourceFileEntry[] {
    if (current_rel_path === undefined) {
      return format_service.collect_source_file_entries(source_paths);
    }
    return format_service
      .normalize_source_paths(source_paths)
      .filter((source_path) => format_service.is_supported_file(source_path))
      .map((source_path) => ({
        source_path,
        rel_path: path.basename(source_path),
      }));
  }

  /**
   * 目录展开后的工作台文件直接使用已分配相对路径，避免再次按单文件规则改名。
   */
  private async parse_source_file_entry(
    format_service: FileFormatService,
    source_file: ProjectSourceFileEntry,
  ): Promise<JsonRecord> {
    const parsed_items = await format_service.parse_asset(
      source_file.rel_path,
      this.native_fs.read_file(source_file.source_path),
    );
    return {
      target_rel_path: source_file.rel_path,
      file_type: format_service.pick_file_type(parsed_items),
      parsed_items: parsed_items.map((item) => Item.from_json(item).to_json()),
    } as unknown as JsonRecord;
  }

  /**
   * 批量解析失败统一写日志；日志内容只保留逐文件原因。
   */
  private log_parse_failures(
    failed_files: SourceFileParseFailureRecord[],
  ): void {
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
