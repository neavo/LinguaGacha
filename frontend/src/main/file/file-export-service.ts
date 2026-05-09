import fs from "node:fs";
import path from "node:path";

import type { ApiJsonValue } from "../api/api-types";
import { CoreBridgeClient } from "../core/core-bridge-client";
import type { ProjectDatabase } from "../database/database-operations";
import { ConfigService } from "../service/config-service";
import { ProjectSessionState } from "../project/project-session-state";
import { FileFormatService } from "./file-format-service";
import {
  item_to_json,
  normalize_file_item,
  normalize_name,
  type FileFormatItem,
  type FileItemStatus,
} from "./file-item";

type JsonRecord = Record<string, ApiJsonValue>;

/**
 * TS 侧导出服务，承载非 EPUB 写回和导出目录语义。
 */
export class FileExportService {
  /**
   * 导出服务依赖当前 .lg 数据库、设置和项目会话，不直接读取 renderer 状态。
   */
  public constructor(
    private readonly database: ProjectDatabase,
    private readonly config_service: ConfigService,
    private readonly session_state: ProjectSessionState,
    private readonly core_bridge: CoreBridgeClient,
  ) {}

  /**
   * 普通导出读取项目全部条目，并先补齐重复条目的译文。
   */
  public async export_translation(): Promise<JsonRecord> {
    const project_path = this.require_loaded_project_path();
    const items = this.read_project_items(project_path);
    this.fill_duplicated_translations(items);
    const output_path = await this.write_export(project_path, items, "");
    return { accepted: true, output_path };
  }

  /**
   * 转换导出只接受前端提交的转换结果，并按 item id 覆盖导出快照。
   */
  public async export_converted_translation(request: JsonRecord): Promise<JsonRecord> {
    const project_path = this.require_loaded_project_path();
    const suffix = String(request["suffix"] ?? "");
    if (suffix !== "_S2T" && suffix !== "_T2S") {
      throw new Error("导出后缀无效。");
    }
    const converted_items = Array.isArray(request["items"])
      ? request["items"].filter(
          (item): item is JsonRecord =>
            typeof item === "object" && item !== null && !Array.isArray(item),
        )
      : [];
    if (converted_items.length === 0) {
      throw new Error("没有可导出的数据。");
    }
    const converted_by_id = new Map<number, JsonRecord>();
    for (const item of converted_items) {
      const item_id = Number(item["item_id"] ?? item["id"] ?? 0);
      if (Number.isFinite(item_id) && item_id > 0) {
        converted_by_id.set(Math.trunc(item_id), item);
      }
    }
    const export_items = this.read_project_items(project_path).map((item) => {
      const converted = item.id === undefined ? undefined : converted_by_id.get(item.id);
      if (converted === undefined) {
        return item;
      }
      return normalize_file_item({
        ...item,
        dst: String(converted["dst"] ?? item.dst),
        name_dst: normalize_name(converted["name_dst"] ?? item.name_dst),
      });
    });
    this.fill_duplicated_translations(export_items);
    const output_path = await this.write_export(project_path, export_items, suffix);
    return { accepted: true, output_path };
  }

  /**
   * 实际写回只处理已迁移到 TS 的非 EPUB 项，EPUB 仍由 Python 旧路径保留。
   */
  private async write_export(
    project_path: string,
    items: FileFormatItem[],
    custom_suffix: string,
  ): Promise<string> {
    const config = this.config_service.load_config();
    const paths = this.build_export_paths(
      project_path,
      custom_suffix,
      String(config["app_language"] ?? "ZH"),
    );
    const format_service = new FileFormatService({
      source_language: String(config["source_language"] ?? "JA"),
      target_language: String(config["target_language"] ?? "ZH"),
      app_language: String(config["app_language"] ?? "ZH"),
      deduplication_in_bilingual: Boolean(config["deduplication_in_bilingual"] ?? true),
      write_translated_name_fields_to_file: Boolean(
        config["write_translated_name_fields_to_file"] ?? true,
      ),
    });
    const non_epub_items = items.filter((item) => item.file_type !== "EPUB");
    await format_service.write_items(non_epub_items, paths, (rel_path) =>
      this.database.read_asset_content(project_path, rel_path),
    );
    const epub_items = items.filter((item) => item.file_type === "EPUB");
    if (epub_items.length > 0) {
      await this.core_bridge.export_epub_items(
        project_path,
        paths.translated_path,
        paths.bilingual_path,
        epub_items.map((item) => item_to_json(item)),
      );
    }
    return paths.translated_path;
  }

  /**
   * 导出目录若已存在则加时间戳，避免覆盖用户已有译文目录。
   */
  private build_export_paths(
    project_path: string,
    custom_suffix: string,
    app_language: string,
  ): { translated_path: string; bilingual_path: string } {
    const suffixes =
      app_language.toUpperCase() === "EN"
        ? { translated: "Translated", bilingual: "Translated_Bilingual" }
        : { translated: "译文", bilingual: "译文_双语对照" };
    const project_dir = path.dirname(project_path);
    const stem = path.parse(project_path).name;
    const translated_base = `${stem}_${suffixes.translated}${custom_suffix}`;
    const bilingual_base = `${stem}_${suffixes.bilingual}${custom_suffix}`;
    const needs_timestamp =
      fs.existsSync(path.join(project_dir, translated_base)) ||
      fs.existsSync(path.join(project_dir, bilingual_base));
    const timestamp = needs_timestamp ? this.timestamp_suffix() : "";
    return {
      translated_path: path.join(project_dir, `${translated_base}${timestamp}`),
      bilingual_path: path.join(project_dir, `${bilingual_base}${timestamp}`),
    };
  }

  /**
   * 从数据库读取条目后立即规范化，后续导出逻辑只处理稳定结构。
   */
  private read_project_items(project_path: string): FileFormatItem[] {
    const raw_items = this.database.execute({
      name: "getAllItems",
      args: { projectPath: project_path },
    });
    if (!Array.isArray(raw_items)) {
      return [];
    }
    return raw_items
      .filter(
        (item): item is JsonRecord =>
          typeof item === "object" && item !== null && !Array.isArray(item),
      )
      .map((item) => normalize_file_item(item_to_json(normalize_file_item(item))));
  }

  /**
   * DUPLICATED 条目复用同文件同原文的已处理译文，保持旧 Python 导出行为。
   */
  private fill_duplicated_translations(items: FileFormatItem[]): void {
    const translation_by_file_src = new Map<string, { dst: string; name_dst: ApiJsonValue }>();
    for (const item of items) {
      if (item.status !== "PROCESSED") {
        continue;
      }
      const key = this.file_src_key(item.file_path, item.src);
      if (!translation_by_file_src.has(key)) {
        translation_by_file_src.set(key, {
          dst: item.dst,
          name_dst: item.name_dst as ApiJsonValue,
        });
      }
    }
    for (const item of items) {
      if (item.status !== "DUPLICATED") {
        continue;
      }
      const translation = translation_by_file_src.get(this.file_src_key(item.file_path, item.src));
      if (translation === undefined) {
        continue;
      }
      item.dst = translation.dst;
      item.name_dst = translation.name_dst as string | string[] | null;
      item.status = "PROCESSED" satisfies FileItemStatus;
    }
  }

  /**
   * 重复译文只在同一文件内传播，避免跨文件同文案误覆盖。
   */
  private file_src_key(file_path: string, src: string): string {
    return `${file_path}\u0000${src}`;
  }

  /**
   * 导出必须依赖已加载工程路径，空会话直接报错给 API 层。
   */
  private require_loaded_project_path(): string {
    const state = this.session_state.snapshot();
    if (!state.loaded || state.projectPath === "") {
      throw new Error("工程未加载。");
    }
    return state.projectPath;
  }

  /**
   * 时间戳格式对齐 Python DataManager 旧导出目录后缀。
   */
  private timestamp_suffix(): string {
    const now = new Date();
    const pad = (value: number): string => value.toString().padStart(2, "0");
    return `_${now.getFullYear().toString()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(
      now.getHours(),
    )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  }
}
