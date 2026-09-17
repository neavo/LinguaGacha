import type { PDFExecution } from "./formats/pdf/pdf-worker";
import { AppError, is_app_error } from "../../shared/error";
import type {
  PDFFileExportResult,
  TranslationFileExportResult,
} from "../../shared/translation-export";
import { render_pdf_translation } from "./formats/pdf/pdf-translation";
import { PDFFormat } from "./formats/pdf/pdf-format";
import path from "node:path";
import type { PDFDocumentRecord } from "../../shared/pdf";

import type { ProjectDatabase } from "../database/database-operations";
import type { LogManager } from "../log/log-manager";
import { AppSettingService } from "../app/app-setting-service";
import { ProjectSessionState } from "../project/project-session-state";
import { FileFormatService } from "./file-format-service";
import { Item, type ItemNameField } from "../../domain/item";
import { is_json_record } from "../../domain/json";
import { resolve_app_locale, type AppLanguage } from "../../domain/app-language";
import { normalize_setting_snapshot, type SettingSnapshot } from "../../domain/setting";
import { create_text_resolver, format_i18n_message, type LocaleKey } from "../../shared/i18n";
import { NativeFs, default_native_fs } from "../../native/native-fs";
import type { ExportPaths } from "./formats/file-format-shared";
import { build_project_item_duplicate_key } from "../../shared/project/project-item-duplicates";

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
    private readonly pdf_execution: PDFExecution,
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
   * GUI 导出固定本次设置快照，读取项目条目并补齐重复译文。
   */
  public async export_files(): Promise<TranslationFileExportResult> {
    return this.run_export(async (project_path, config) => {
      const items = this.read_project_items(project_path);
      const documents = this.read_export_pdf_files(
        project_path,
        Object.keys(this.database.read_pdf_summaries(project_path)),
      );
      const paths = this.build_export_paths(project_path, config.app_language);
      await this.write_export_to_paths(project_path, items, paths, config);
      const pdf_files = await this.write_pdf_files(project_path, paths, documents);
      return { accepted: true as const, output_path: paths.translated_path, pdf_files };
    }, true);
  }

  /** Agent 的单文件导出复用目录、快照与正式 writer，不把工作预览当作工程交付。 */
  public async export_pdf_file(
    file_path: string,
    signal?: AbortSignal,
  ): Promise<{ output_path: string }> {
    const result = await this.run_export(async (project_path, config) => {
      const documents = this.read_export_pdf_files(project_path, [file_path]);
      const paths = this.build_export_paths(project_path, config.app_language);
      await this.write_pdf_files(project_path, paths, documents, signal);
      return { output_path: paths.translated_path };
    }, true);
    return { output_path: path.join(result.output_path, file_path) };
  }

  /**
   * CLI 导出直接写入用户指定目录，覆盖既有文件且不触发 GUI 打开目录副作用。
   */
  public async export_files_to_directory(
    output_dir: string,
    excluded_files: readonly string[] = [],
  ): Promise<TranslationFileExportResult> {
    return this.run_export(async (project_path, config) => {
      const items = this.read_project_items(project_path);
      const documents = this.read_export_pdf_files(
        project_path,
        Object.keys(this.database.read_pdf_summaries(project_path)).filter(
          (file_path) => !excluded_files.includes(file_path),
        ),
      );
      const paths = this.build_cli_export_paths(output_dir);
      await this.write_export_to_paths(
        project_path,
        items.filter((item) => !excluded_files.includes(item.file_path)),
        paths,
        config,
      );
      const pdf_files = await this.write_pdf_files(project_path, paths, documents);
      return {
        accepted: true as const,
        output_path: paths.translated_path,
        bilingual_output_path: paths.bilingual_path,
        pdf_files,
      };
    }, false);
  }

  /** 三个导出入口共享任务终态和未知异常归属，日志直接保留原始原因与调用栈。 */
  private async run_export<T extends { output_path: string }>(
    write: (project_path: string, config: SettingSnapshot) => Promise<T>,
    open_output_folder: boolean,
  ): Promise<T> {
    const project_path = this.session_state.require_loaded_project_path();
    const config = normalize_setting_snapshot(this.app_setting_service.read_setting());
    this.log_export_start(config);
    try {
      const result = await write(project_path, config);
      this.log_export_done(config, result.output_path);
      if (open_output_folder) await this.open_output_folder(config, result.output_path);
      return result;
    } catch (error) {
      this.log_manager?.error(
        this.export_log_text(config, "app.error.translation.export_failed.message"),
        { source: FILE_EXPORT_LOG_SOURCE, error },
      );
      throw is_app_error(error)
        ? error
        : new AppError("translation.export_failed", { cause: error });
    }
  }

  /**
   * 按调用方指定的目录组写出译文，GUI 和 CLI 共享格式分发与 asset 读取逻辑。
   */
  private async write_export_to_paths(
    project_path: string,
    items: Item[],
    paths: ExportPaths,
    config: SettingSnapshot,
  ): Promise<void> {
    this.fill_duplicated_translations(items);
    const format_service = new FileFormatService(
      {
        target_language: config.target_language,
        deduplication_in_bilingual: config.deduplication_in_bilingual,
        write_translated_name_fields_to_file: config.write_translated_name_fields_to_file,
      },
      this.pdf_execution,
      this.native_fs,
    );
    await format_service.write_items(items, {
      paths,
      asset_reader: (rel_path) => this.database.read_asset_content(project_path, rel_path),
    });
  }

  /** 在任何输出落盘前固定译稿并验证可确定条件，避免不同入口各自解释 PDF 规则。 */
  private read_export_pdf_files(
    project_path: string,
    file_paths: readonly string[],
  ): PDFDocumentRecord[] {
    return file_paths.map((file_path) => {
      const document = this.database.read_pdf_document(project_path, file_path);
      if (!document) throw new AppError("file.not_found", { public_details: { file: file_path } });
      try {
        render_pdf_translation(document);
      } catch (error) {
        throw new AppError("file.invalid_structure", {
          public_details: { file: file_path },
          cause: error,
        });
      }
      return { file_path, document };
    });
  }

  /** 落盘成功后按原页覆盖生成回执，输出页数由打印排版决定。 */
  private async write_pdf_files(
    project_path: string,
    paths: ExportPaths,
    documents: readonly PDFDocumentRecord[],
    signal?: AbortSignal,
  ): Promise<PDFFileExportResult[]> {
    await new PDFFormat(this.pdf_execution).write_to_path(documents, {
      paths,
      asset_reader: (file_path) => this.database.read_asset_content(project_path, file_path),
      signal,
    });
    return documents.map(({ file_path, document }) => {
      let translated_pages = 0;
      let omitted_pages = 0;
      for (const page of document.pages) {
        if (page.translation?.kind === "translate") translated_pages++;
        else if (page.translation?.kind === "omit") omitted_pages++;
      }
      return {
        file_path,
        translated_pages,
        original_pages: document.pages.length - translated_pages - omitted_pages,
        omitted_pages,
      };
    });
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
  private async open_output_folder(config: SettingSnapshot, output_path: string): Promise<void> {
    if (!config.output_folder_open_on_finish) {
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
  private build_export_paths(project_path: string, app_language: AppLanguage): ExportPaths {
    const text = create_text_resolver(resolve_app_locale(app_language));
    const translated_suffix = text("app.translation_export.directory.translated");
    const bilingual_suffix = text("app.translation_export.directory.bilingual");
    const project_dir = path.dirname(project_path);
    const stem = path.parse(project_path).name;
    const translated_base = `${stem}_${translated_suffix}`;
    const bilingual_base = `${stem}_${bilingual_suffix}`;
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
    const raw_items = this.database.get_all_items(project_path);
    if (!Array.isArray(raw_items)) {
      return [];
    }
    return raw_items.filter(is_json_record).map((item) => Item.from_json(item));
  }

  /**
   * DUPLICATED 条目按项目统一重复身份复用已处理译文。
   */
  private fill_duplicated_translations(items: Item[]): void {
    const translations = new Map<string, { dst: string; name_dst: ItemNameField }>();
    for (const item of items) {
      if (item.status !== "PROCESSED") {
        continue;
      }
      const key = build_project_item_duplicate_key(item);
      if (!translations.has(key)) {
        translations.set(key, {
          dst: item.dst,
          name_dst: item.name_dst,
        });
      }
    }
    for (const item of items) {
      if (item.status !== "DUPLICATED") {
        continue;
      }
      const translation = translations.get(build_project_item_duplicate_key(item));
      if (translation === undefined) {
        continue;
      }
      item.dst = translation.dst;
      item.name_dst = translation.name_dst;
      item.status = "PROCESSED";
    }
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
    config: SettingSnapshot,
    key: LocaleKey,
    params: Record<string, string> = {},
  ): string {
    return format_i18n_message(resolve_app_locale(config.app_language), key, params);
  }

  /**
   * 开始日志在真实文件写回前输出，便于日志窗口定位用户触发的导出动作
   */
  private log_export_start(config: SettingSnapshot): void {
    this.log_manager?.info(this.export_log_text(config, "app.log.generate_translation_start"), {
      source: FILE_EXPORT_LOG_SOURCE,
    });
  }

  /**
   * 完成日志输出前后空行，避免连续任务日志挤在一起
   */
  private log_export_done(config: SettingSnapshot, output_path: string): void {
    this.log_manager?.info("", { source: FILE_EXPORT_LOG_SOURCE });
    this.log_manager?.info(
      this.export_log_text(config, "app.log.generate_translation_done", { PATH: output_path }),
      { source: FILE_EXPORT_LOG_SOURCE },
    );
    this.log_manager?.info("", { source: FILE_EXPORT_LOG_SOURCE });
  }

  /**
   * 打开输出目录失败只影响宿主体验，不改变导出成功结果
   */
  private log_open_output_folder_failed(config: SettingSnapshot, error: unknown): void {
    this.log_manager?.error(
      this.export_log_text(config, "app.diagnostic.file_export.open_output_folder_failed"),
      {
        source: FILE_EXPORT_LOG_SOURCE,
        error,
      },
    );
  }
}
