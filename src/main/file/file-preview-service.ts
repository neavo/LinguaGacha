import fs from "node:fs";
import path from "node:path";

import type { ApiJsonValue } from "../api/api-types";
import { SettingService } from "../service/setting-service";
import { FileFormatService } from "./file-format-service";
import { Item } from "../../base/item";
import * as AppErrors from "../../shared/error";

type JsonRecord = Record<string, ApiJsonValue>;

/**
 * 文件解析预演服务；公开源文件草稿只由 main 进程文件域解析
 */
export class FilePreviewService {
  /**
   * 预演服务只编排配置和 格式处理器，不直接写数据库
   */
  public constructor(private readonly setting_service: SettingService) {}

  /**
   * 工作台单文件预解析返回成功与失败清单，避免批量输入失败被静默吞掉
   */
  public async parse_workbench_file(request: JsonRecord): Promise<JsonRecord> {
    const source_paths = this.normalize_string_list(request["source_paths"]);
    const current_rel_path =
      typeof request["current_rel_path"] === "string" ? request["current_rel_path"] : undefined;
    const format_service = this.create_format_service();
    const files: JsonRecord[] = [];
    const failed_files: JsonRecord[] = [];
    for (const source_path of source_paths) {
      try {
        const parsed = await format_service.parse_file_preview(source_path, current_rel_path);
        files.push({ source_path, ...(parsed as unknown as JsonRecord) });
      } catch (error) {
        const preview_error = this.normalize_preview_error(error);
        failed_files.push({
          source_path,
          filename: path.basename(source_path),
          code: preview_error.code,
          message_key: preview_error.message_key,
        });
      }
    }
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
    const items: JsonRecord[] = [];
    let next_item_id = 1;
    for (const [sort_index, source_file] of source_files.entries()) {
      const parsed_items = await format_service.parse_asset(
        source_file.rel_path,
        fs.readFileSync(source_file.source_path),
      );
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
        sort_index,
        source_path: source_file.source_path,
      });
    }
    return {
      draft: {
        source_paths: effective_source_paths,
        files,
        items,
        section_revisions: { files: 0, items: 0, analysis: 0 },
      },
    };
  }

  /**
   * 每次按当前配置创建格式服务，避免设置页改动后预演仍使用旧语言
   */
  private create_format_service(): FileFormatService {
    const config = this.setting_service.load_setting();
    return new FileFormatService({
      source_language: String(config["source_language"] ?? "JA"),
      target_language: String(config["target_language"] ?? "ZH"),
      app_language: String(config["app_language"] ?? "ZH"),
      deduplication_in_bilingual: Boolean(config["deduplication_in_bilingual"] ?? true),
      write_translated_name_fields_to_file: Boolean(
        config["write_translated_name_fields_to_file"] ?? true,
      ),
    });
  }

  /**
   * API 入参只接受非空字符串路径，其他值直接丢弃
   */
  private normalize_string_list(value: ApiJsonValue | undefined): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "")
      : [];
  }

  /**
   * 单文件失败只暴露稳定 code 和 message_key，原始异常留给 Gateway 日志
   */
  private normalize_preview_error(error: unknown): AppErrors.AppError {
    if (AppErrors.is_app_error(error)) {
      return error;
    }
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return new AppErrors.FileNotFoundError({ cause: error });
    }
    return new AppErrors.FileIoFailedError({ cause: error });
  }
}
