import type { PDFExecution } from "./pdf/pdf-worker";
import { AppError, is_app_error } from "../../shared/error";
import type {
  PDFFileGenerationResult,
  TranslationFileGenerationResult,
} from "../../shared/translation-generation";
import { render_pdf_translation } from "./pdf/pdf-translation";
import { PDFFormat } from "./pdf/pdf-format";
import path from "node:path";
import type { PDFDocumentRecord } from "../../shared/pdf";

import type { ProjectDatabase } from "../database/database-operations";
import type { LogManager } from "../log/log-manager";
import { AppSettingService } from "../app/app-setting-service";
import { ProjectSessionState } from "../project/project-session-state";
import { FileFormatService } from "./file-format-service";
import { type ItemNameField, type Item, create_item } from "../../domain/item";
import { is_json_record } from "../../domain/json";
import { resolve_app_locale, type AppLanguage } from "../../domain/app-language";
import { normalize_setting_snapshot, type SettingSnapshot } from "../../domain/setting";
import { create_text_resolver, format_i18n_message, type LocaleKey } from "../../shared/i18n";
import { NativeFs, default_native_fs } from "../../native/native-fs";
import type { GeneratedFilePaths } from "./file-format-shared";
import { build_project_item_duplicate_key } from "../../shared/project/project-item-duplicates";

/**
 * 译文生成层只依赖日志的公开 info/error 能力，避免把完整 LogManager 生命周期传进文件域
 */
type FileGenerationLogManager = Pick<LogManager, "info" | "error">;

/**
 * 文件译文生成日志使用固定 source，便于日志侧区分文件域输出
 */
const FILE_GENERATION_LOG_SOURCE = "translation-generation";

export type OutputFolderOpener = (output_path: string) => Promise<void>;

/**
 * 文件译文生成服务承载全部公开文件格式写回和译文生成目录语义
 */
export class TranslationFileGenerationService {
  /**
   * 译文生成服务依赖当前 .lg 数据库、设置和项目会话，不直接读取渲染进程状态
   */
  public constructor(
    private readonly database: ProjectDatabase, // 译文生成读取工程事实和原稿资产的入口
    private readonly app_setting_service: AppSettingService, // 译文生成语言、格式和完成后动作
    private readonly session_state: ProjectSessionState, // 当前 .lg 工程身份
    private readonly output_folder_opener: OutputFolderOpener, // 宿主打开目录的副作用
    private readonly pdf_execution: PDFExecution, // 独立线程的 PDF 计算端口
    private readonly log_manager?: FileGenerationLogManager, // 译文生成诊断
    private readonly native_fs: NativeFs = default_native_fs, // 目录检查与文件写盘
  ) {}

  /**
   * GUI 译文生成固定本次设置快照，读取项目条目并补齐重复译文。
   */
  public async generate_files(): Promise<TranslationFileGenerationResult> {
    return this.run_generation(async (project_path, config) => {
      const items = this.read_project_items(project_path);
      const documents = this.read_generation_pdf_files(
        project_path,
        Object.keys(this.database.read_pdf_summaries(project_path)),
      );
      const paths = this.build_generation_paths(project_path, config.app_language);
      await this.generate_to_paths(project_path, items, paths, config);
      const pdf_files = await this.write_pdf_files(project_path, paths, documents);
      return {
        accepted: true as const,
        output_path: paths.translated_path,
        pdf_files,
      };
    }, true);
  }

  /**
   * CLI 译文生成直接写入用户指定目录，覆盖既有文件且不触发 GUI 打开目录副作用。
   */
  public async generate_files_to_directory(
    output_dir: string,
    excluded_files: readonly string[] = [],
  ): Promise<TranslationFileGenerationResult> {
    return this.run_generation(async (project_path, config) => {
      const items = this.read_project_items(project_path);
      const documents = this.read_generation_pdf_files(
        project_path,
        Object.keys(this.database.read_pdf_summaries(project_path)).filter(
          (file_path) => !excluded_files.includes(file_path),
        ),
      );
      const paths = this.build_cli_generation_paths(output_dir);
      await this.generate_to_paths(
        project_path,
        items.filter((item) => !excluded_files.includes(item.file_path)),
        paths,
        config,
        excluded_files,
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

  /** GUI 与 CLI 共享任务终态和未知异常归属，日志直接保留原始原因与调用栈。 */
  private async run_generation(
    write: (
      project_path: string,
      config: SettingSnapshot,
    ) => Promise<TranslationFileGenerationResult>,
    open_output_folder: boolean,
  ): Promise<TranslationFileGenerationResult> {
    const config = normalize_setting_snapshot(this.app_setting_service.read_setting());
    this.log_manager?.info(
      this.generation_log_text(config, "app.translation_generation.log.started"),
      { source: FILE_GENERATION_LOG_SOURCE },
    );
    try {
      const project_path = this.session_state.require_loaded_project_path();
      const result = await write(project_path, config);
      this.log_manager?.info(
        `${this.generation_log_text(config, "app.translation_generation.log.succeeded")}\n${result.output_path}`,
        { source: FILE_GENERATION_LOG_SOURCE },
      );
      if (open_output_folder) await this.open_output_folder(config, result.output_path);
      return result;
    } catch (error) {
      this.log_manager?.error(
        {
          kind: "text",
          text: `${this.generation_log_text(config, "app.translation_generation.log.failed")}\n${error instanceof Error ? error.message : String(error)}`,
        },
        {
          source: FILE_GENERATION_LOG_SOURCE,
          error,
        },
      );
      throw is_app_error(error)
        ? error
        : new AppError("translation.generation_failed", { cause: error });
    }
  }

  /**
   * 按调用方指定的目录组写出译文，GUI 和 CLI 共享格式分发与 asset 读取逻辑。
   */
  private async generate_to_paths(
    project_path: string,
    items: Item[],
    paths: GeneratedFilePaths,
    config: SettingSnapshot,
    excluded_files: readonly string[] = [],
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
      source_files: this.database
        .get_all_asset_records(project_path)
        .map((record) => record.path)
        .filter((file) => !excluded_files.includes(file)),
    });
  }

  /** 在任何输出落盘前固定译稿并验证可确定条件，避免不同入口各自解释 PDF 规则。 */
  private read_generation_pdf_files(
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
    paths: GeneratedFilePaths,
    documents: readonly PDFDocumentRecord[],
  ): Promise<PDFFileGenerationResult[]> {
    const written = await new PDFFormat(this.pdf_execution).write_to_path(documents, {
      paths,
      asset_reader: (file_path) => this.database.read_asset_content(project_path, file_path),
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
        written: written.includes(file_path),
        translated_pages,
        original_pages: document.pages.length - translated_pages - omitted_pages,
        omitted_pages,
      };
    });
  }

  /**
   * CLI 的单一 output-dir 承载译文，双语对照作为同目录下固定子目录。
   */
  private build_cli_generation_paths(output_dir: string): GeneratedFilePaths {
    const translated_path = path.resolve(output_dir);
    const bilingual_path = path.join(translated_path, "bilingual");
    this.native_fs.make_dir(translated_path);
    this.native_fs.make_dir(bilingual_path);
    return { translated_path, bilingual_path };
  }

  /**
   * 译文生成成功后的宿主附加动作不能推翻译文已经写出的事实
   */
  private async open_output_folder(config: SettingSnapshot, output_path: string): Promise<void> {
    if (!config.output_folder_open_on_finish) {
      return;
    }
    try {
      await this.output_folder_opener(output_path);
    } catch (error) {
      this.log_manager?.error(
        this.generation_log_text(
          config,
          "app.translation_generation.log.open_output_folder_failed",
        ),
        { source: FILE_GENERATION_LOG_SOURCE, error },
      );
    }
  }

  /**
   * 译文生成目录若已存在则加时间戳，避免覆盖用户已有译文目录
   */
  private build_generation_paths(
    project_path: string,
    app_language: AppLanguage,
  ): GeneratedFilePaths {
    const text = create_text_resolver(resolve_app_locale(app_language));
    const translated_suffix = text("app.translation_generation.directory.translated");
    const bilingual_suffix = text("app.translation_generation.directory.bilingual");
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
   * 从数据库读取条目后立即规范化，后续译文生成逻辑只处理稳定结构
   */
  private read_project_items(project_path: string): Item[] {
    const raw_items = this.database.get_all_items(project_path);
    if (!Array.isArray(raw_items)) {
      return [];
    }
    return raw_items.filter(is_json_record).map((item) => create_item(item));
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
   * 时间戳使用固定译文生成目录后缀格式
   */
  private timestamp_suffix(): string {
    const now = new Date();
    const pad = (value: number): string => value.toString().padStart(2, "0");
    return `_${now.getFullYear().toString()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(
      now.getHours(),
    )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  }

  /**
   * 译文生成日志文案跟随应用语言，保持文件写回路径和既有译文生成提示一致
   */
  private generation_log_text(config: SettingSnapshot, key: LocaleKey): string {
    return format_i18n_message(resolve_app_locale(config.app_language), key);
  }
}
