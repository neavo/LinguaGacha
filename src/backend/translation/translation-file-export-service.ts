import path from "node:path";

import type { ApiJsonValue } from "../api/api-types";
import type { ProjectDatabase } from "../database/database-operations";
import type { LogManager } from "../log/log-manager";
import { AppSettingService } from "../app/app-setting-service";
import { ProjectSessionState } from "../project/project-session";
import { FileFormatService } from "../file/file-format-service";
import { Item, type ItemStatus } from "../../domain/item";
import { normalize_setting_snapshot } from "../../domain/setting";
import { format_i18n_message, resolve_i18n_locale, type LocaleKey } from "../../shared/i18n";
import * as AppErrors from "../../shared/error";
import { NativeFs, default_native_fs } from "../../native/native-fs";
import type { ExportPaths } from "../file/formats/file-format-shared";

/**
 * API 入参和返回值在文件域内按 JSON 对象处理，避免暴露内部类实例
 */
type JsonRecord = Record<string, ApiJsonValue>;

/**
 * 设置服务返回值只承诺 JSON 形态，导出层按需要逐项收窄类型
 */
type SettingRecord = Record<string, ApiJsonValue>;

/**
 * 导出层只依赖日志的公开 info/error 能力，避免把完整 LogManager 生命周期传进文件域
 */
type FileExportLogManager = Pick<LogManager, "info" | "error">;

/**
 * 文件导出日志使用固定 source，便于日志侧区分文件域输出
 */
const FILE_EXPORT_LOG_SOURCE = "file-export";

export type OutputFolderOpener = (output_path: string) => Promise<void>;

/**
 * 文件导出服务承载全部公开文件格式写回和导出目录语义
 */
export class TranslationFileExportService {
  private readonly database: ProjectDatabase; // 导出读取项目事实和 asset bytes 的唯一入口
  private readonly app_setting_service: AppSettingService; // 提供导出语言、格式和完成后动作配置
  private readonly session_state: ProjectSessionState; // 决定当前导出的 .lg 工程
  private readonly output_folder_opener: OutputFolderOpener; // 隔离宿主打开目录副作用
  private readonly log_manager?: FileExportLogManager; // 只承接导出诊断日志
  private readonly native_fs: NativeFs; // 负责导出目录存在性判断和格式写盘策略传递

  /**
   * 导出服务依赖当前 .lg 数据库、设置和项目会话，不直接读取渲染进程状态
   */
  public constructor(
    database: ProjectDatabase,
    app_setting_service: AppSettingService,
    session_state: ProjectSessionState,
    output_folder_opener: OutputFolderOpener,
    log_manager?: FileExportLogManager,
    native_fs: NativeFs = default_native_fs,
  ) {
    this.database = database;
    this.app_setting_service = app_setting_service;
    this.session_state = session_state;
    this.output_folder_opener = output_folder_opener;
    this.log_manager = log_manager;
    this.native_fs = native_fs;
  }

  /**
   * 生成译文读取项目全部条目，并先补齐重复条目的译文
   */
  public async export_files(): Promise<JsonRecord> {
    const project_path = this.require_loaded_project_path();
    const config = this.app_setting_service.read_setting();
    this.log_export_start(config);
    try {
      const items = this.read_project_items(project_path);
      this.fill_duplicated_translations(items);
      const output_path = await this.write_export(project_path, items, "", config);
      await this.complete_export_success(config, output_path);
      return { accepted: true, output_path };
    } catch (error) {
      this.log_export_failed(config, error);
      throw error;
    }
  }

  /**
   * CLI 导出直接写入用户指定目录，覆盖既有文件且不触发 GUI 打开目录副作用。
   */
  public async export_files_to_directory(output_dir: string): Promise<JsonRecord> {
    const project_path = this.require_loaded_project_path();
    const config = this.app_setting_service.read_setting();
    this.log_export_start(config);
    try {
      const items = this.read_project_items(project_path);
      this.fill_duplicated_translations(items);
      const paths = this.build_cli_export_paths(output_dir);
      await this.write_export_to_paths(project_path, items, paths, config);
      this.log_export_done(config, paths.translated_path);
      return {
        accepted: true,
        output_path: paths.translated_path,
        bilingual_output_path: paths.bilingual_path,
      };
    } catch (error) {
      this.log_export_failed(config, error);
      throw error;
    }
  }

  /**
   * 后端内部转换服务传入已由当前项目事实计算的导出快照，避免渲染进程提交计算 items。
   */
  public async export_items_with_suffix(
    items: Item[],
    suffix: "_S2T" | "_T2S",
  ): Promise<JsonRecord> {
    const project_path = this.require_loaded_project_path();
    const config = this.app_setting_service.read_setting();
    this.fill_duplicated_translations(items);
    this.log_export_start(config);
    try {
      const output_path = await this.write_export(project_path, items, suffix, config);
      await this.complete_export_success(config, output_path);
      return { accepted: true, output_path };
    } catch (error) {
      this.log_export_failed(config, error);
      throw error;
    }
  }

  /**
   * 实际写回统一进入文件域，避免文件格式能力在多个入口分叉
   */
  private async write_export(
    project_path: string,
    items: Item[],
    custom_suffix: string,
    config: SettingRecord,
  ): Promise<string> {
    const setting_snapshot = normalize_setting_snapshot(config);
    const paths = this.build_export_paths(
      project_path,
      custom_suffix,
      setting_snapshot.app_language,
    );
    await this.write_export_to_paths(project_path, items, paths, config);
    return paths.translated_path;
  }

  /**
   * 按调用方指定的目录组写出译文，GUI 和 CLI 共享格式分发与 asset 读取逻辑。
   */
  private async write_export_to_paths(
    project_path: string,
    items: Item[],
    paths: ExportPaths,
    config: SettingRecord,
  ): Promise<void> {
    const setting_snapshot = normalize_setting_snapshot(config);
    const format_service = new FileFormatService(
      {
        source_language: setting_snapshot.source_language,
        target_language: setting_snapshot.target_language,
        app_language: setting_snapshot.app_language,
        deduplication_in_bilingual: setting_snapshot.deduplication_in_bilingual,
        write_translated_name_fields_to_file: setting_snapshot.write_translated_name_fields_to_file,
      },
      this.native_fs,
    );
    try {
      await format_service.write_items(items, paths, (rel_path) =>
        this.database.read_asset_content(project_path, rel_path),
      );
    } catch (error) {
      this.log_write_failed(config, error);
      throw error;
    }
  }

  /**
   * CLI 的单一 output-dir 承载译文，双语对照作为同目录下固定子目录。
   */
  private build_cli_export_paths(output_dir: string): ExportPaths {
    const translated_path = path.resolve(output_dir);
    const bilingual_path = path.join(translated_path, "bilingual");
    this.native_fs.make_dir(translated_path);
    this.native_fs.make_dir(bilingual_path);
    return { translated_path, bilingual_path };
  }

  /**
   * 导出成功后的宿主附加动作不能推翻译文已经写出的事实
   */
  private async complete_export_success(config: SettingRecord, output_path: string): Promise<void> {
    const setting_snapshot = normalize_setting_snapshot(config);
    this.log_export_done(config, output_path);
    if (!setting_snapshot.output_folder_open_on_finish) {
      return;
    }
    try {
      await this.output_folder_opener(output_path);
    } catch (error) {
      this.log_open_output_folder_failed(config, error);
    }
  }

  /**
   * 导出目录若已存在则加时间戳，避免覆盖用户已有译文目录
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
      this.native_fs.exists(path.join(project_dir, translated_base)) ||
      this.native_fs.exists(path.join(project_dir, bilingual_base));
    const timestamp = needs_timestamp ? this.timestamp_suffix() : "";
    return {
      translated_path: path.join(project_dir, `${translated_base}${timestamp}`),
      bilingual_path: path.join(project_dir, `${bilingual_base}${timestamp}`),
    };
  }

  /**
   * 从数据库读取条目后立即规范化，后续导出逻辑只处理稳定结构
   */
  private read_project_items(project_path: string): Item[] {
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
      .map((item) => Item.from_json(item));
  }

  /**
   * DUPLICATED 条目复用同文件同原文的已处理译文，保持导出口径稳定
   */
  private fill_duplicated_translations(items: Item[]): void {
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
      item.status = "PROCESSED" satisfies ItemStatus;
    }
  }

  /**
   * 重复译文只在同一文件内传播，避免跨文件同文案误覆盖
   */
  private file_src_key(file_path: string, src: string): string {
    return `${file_path}\u0000${src}`;
  }

  /**
   * 导出必须依赖已加载工程路径，空会话直接报错给 API 层
   */
  private require_loaded_project_path(): string {
    const state = this.session_state.snapshot();
    if (!state.loaded || state.projectPath === "") {
      throw new AppErrors.ProjectNotLoadedError();
    }
    return state.projectPath;
  }

  /**
   * 时间戳使用固定导出目录后缀格式
   */
  private timestamp_suffix(): string {
    const now = new Date();
    const pad = (value: number): string => value.toString().padStart(2, "0");
    return `_${now.getFullYear().toString()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(
      now.getHours(),
    )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  }

  /**
   * 导出日志文案跟随应用语言，保持文件写回路径和既有导出提示一致
   */
  private export_log_text(
    config: SettingRecord,
    key: LocaleKey,
    params: Record<string, string> = {},
  ): string {
    return format_i18n_message(
      resolve_i18n_locale(normalize_setting_snapshot(config).app_language),
      key,
      params,
    );
  }

  /**
   * 开始日志在真实文件写回前输出，便于日志窗口定位用户触发的导出动作
   */
  private log_export_start(config: SettingRecord): void {
    this.log_manager?.info(this.export_log_text(config, "app.log.generate_translation_start"), {
      source: FILE_EXPORT_LOG_SOURCE,
    });
  }

  /**
   * 完成日志输出前后空行，避免连续任务日志挤在一起
   */
  private log_export_done(config: SettingRecord, output_path: string): void {
    this.log_manager?.info("", { source: FILE_EXPORT_LOG_SOURCE });
    this.log_manager?.info(
      this.export_log_text(config, "app.log.generate_translation_done", { PATH: output_path }),
      { source: FILE_EXPORT_LOG_SOURCE },
    );
    this.log_manager?.info("", { source: FILE_EXPORT_LOG_SOURCE });
  }

  /**
   * 底层写文件失败时先记录文件写入错误，再让公开导出入口记录导出失败
   */
  private log_write_failed(config: SettingRecord, error: unknown): void {
    this.log_manager?.error(
      this.export_log_text(config, "app.diagnostic.file_export.write_file_failed"),
      {
        source: FILE_EXPORT_LOG_SOURCE,
        error,
      },
    );
  }

  /**
   * 打开输出目录失败只影响宿主体验，不改变导出成功结果
   */
  private log_open_output_folder_failed(config: SettingRecord, error: unknown): void {
    this.log_manager?.error(
      this.export_log_text(config, "app.diagnostic.file_export.open_output_folder_failed"),
      {
        source: FILE_EXPORT_LOG_SOURCE,
        error,
      },
    );
  }

  /**
   * 导出失败日志输出终态提示，同时保留异常详情给日志文件
   */
  private log_export_failed(config: SettingRecord, error: unknown): void {
    this.log_manager?.error(
      this.export_log_text(config, "app.diagnostic.file_export.translation_failed"),
      {
        source: FILE_EXPORT_LOG_SOURCE,
        error,
      },
    );
  }
}
