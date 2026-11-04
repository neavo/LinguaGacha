import { GameDirectoryOperations } from "./shared/game/game-directory-operations";
import type { PDFExecution } from "./pdf/pdf-worker";
import { AppError, is_app_error } from "../../shared/error";
import type {
  PDFFileGenerationResult,
  TranslationOutputPaths,
  TranslationFileGenerationResult,
} from "../../shared/translation-generation";
import { render_pdf_translation } from "./pdf/pdf-translation";
import { PDFFormat } from "./pdf/pdf-format";
import path from "node:path";
import type { PDFDocumentRecord } from "../../shared/pdf";
import type { JsonRecord } from "../../domain/json";

import type { ProjectDatabase } from "../database/database-operations";
import type { LogManager } from "../log/log-manager";
import { AppSettingService } from "../app/app-setting-service";
import { ProjectSessionState } from "../project/project-session-state";
import { FileFormatService } from "./file-format-service";
import { type Item, create_item } from "../../domain/item";
import { resolve_app_locale, type AppLanguage } from "../../domain/app-language";
import { normalize_setting_snapshot, type SettingSnapshot } from "../../domain/setting";
import {
  build_project_execution_settings,
  read_project_language_settings,
} from "../../domain/project-settings";
import { create_text_resolver, format_i18n_message, type LocaleKey } from "../../shared/i18n";
import { NativeFs, default_native_fs } from "../../native/native-fs";
import type { GeneratedFilePaths } from "./file-format-types";
import { build_project_item_duplicate_key } from "../../shared/project/project-item-duplicates";

/**
 * 译文生成层只依赖日志的公开 info/error 能力，避免把完整 LogManager 生命周期传进文件域
 */
type FileGenerationLogManager = Pick<LogManager, "info" | "error">;

const FILE_GENERATION_LOG_SOURCE = "translation-generation"; // 各入口共用日志来源，便于按文件域筛选。

type GenerationTarget = Readonly<{
  paths: GeneratedFilePaths;
  generic_path?: string; // 提供目录时才生成通用写回输入。
  skip_pdf: boolean;
}>;

export type OutputFolderOpener = (output_path: string) => Promise<void>;

/**
 * 文件译文生成服务承载全部公开文件格式写回和译文生成目录语义
 */
export class TranslationFileGenerationService {
  /**
   * 译文生成服务依赖当前 .lg 数据库、设置和项目会话，不直接读取渲染进程状态
   */
  public constructor(
    private readonly game_directory_operations: GameDirectoryOperations,
    private readonly database: ProjectDatabase, // 译文生成读取工程事实和原稿资产的入口
    private readonly app_setting_service: AppSettingService, // 译文生成格式和完成后动作
    private readonly session_state: ProjectSessionState, // 当前 .lg 工程身份
    private readonly output_folder_opener: OutputFolderOpener, // 宿主打开目录的副作用
    private readonly pdf_execution: PDFExecution, // 独立线程的 PDF 计算端口
    private readonly log_manager?: FileGenerationLogManager, // 译文生成诊断
    private readonly native_fs: NativeFs = default_native_fs, // 目录检查与文件写盘
  ) {}

  /**
   * GUI 译文生成固定本次设置快照，读取项目条目并补齐重复译文。
   */
  public async generate_files(request: unknown): Promise<TranslationFileGenerationResult> {
    return this.run_generation(async (project_path, setting) => {
      // 请求校验先于工程读取，防止目录选择期间切换工程后生成错误的内容。
      if (typeof request !== "object" || request === null || Array.isArray(request)) {
        throw new Error("Invalid generation request");
      }
      const input = request as Record<string, unknown>;
      if (
        input.project_path !== project_path ||
        (input.output_directory !== undefined && typeof input.output_directory !== "string")
      ) {
        throw new Error("Invalid project or output directory");
      }
      return this.write_files(project_path, setting, {
        paths: this.resolve_output_paths(project_path, setting, input.output_directory),
        skip_pdf: false,
      });
    }, true);
  }

  /** CLI 保留既有目录布局，跳过页面翻译与通用写回。 */
  public async generate_files_to_directory(
    output_dir: string,
  ): Promise<TranslationFileGenerationResult> {
    return this.run_generation(
      (project_path, setting) =>
        this.write_files(project_path, setting, {
          paths: {
            translated_path: path.resolve(output_dir),
            bilingual_path: path.resolve(output_dir, "bilingual"),
          },
          skip_pdf: true,
        }),
      false,
    );
  }

  /** 工作材料与可交付产物分开存放，交付前由 Agent 核对完整集合。 */
  public async generate_staging_files(
    output_dir: string,
  ): Promise<TranslationFileGenerationResult> {
    return this.run_generation(
      (project_path, setting) =>
        this.write_files(project_path, setting, {
          paths: {
            translated_path: path.resolve(output_dir, "translated"),
            bilingual_path: path.resolve(output_dir, "bilingual"),
          },
          generic_path: path.resolve(output_dir, "generic"),
          skip_pdf: false,
        }),
      false,
    );
  }

  /** 只查询交付位置，目录创建留给实际写入者。 */
  public read_output_paths(directory?: string): TranslationOutputPaths {
    return this.resolve_output_paths(
      this.session_state.require_loaded_project_path(),
      this.app_setting_service.read_setting(),
      directory,
    );
  }

  /** GUI 与 Agent 共用设置解释和命名规则，只计算路径，不占用目录。 */
  private resolve_output_paths(
    project_path: string,
    setting: JsonRecord,
    directory?: string,
  ): TranslationOutputPaths {
    const config = normalize_setting_snapshot(setting);
    const output_directory =
      directory ??
      (config.translation_save_mode === "FIXED"
        ? config.translation_fixed_path
        : path.dirname(project_path));
    if (!path.isAbsolute(output_directory)) throw new Error("Invalid project or output directory");
    if (!this.native_fs.stat(output_directory).isDirectory())
      throw new Error("Output path is not a directory");
    return {
      manual: directory === undefined && config.translation_save_mode === "MANUAL",
      ...this.build_generation_paths(project_path, output_directory, config.app_language),
    };
  }

  /** 各入口共用生成结果与错误归属，日志保留原始原因和调用栈。 */
  private async run_generation(
    write: (project_path: string, setting: JsonRecord) => Promise<TranslationFileGenerationResult>,
    open_output_folder: boolean,
  ): Promise<TranslationFileGenerationResult> {
    const setting = this.app_setting_service.read_setting();
    const config = normalize_setting_snapshot(setting);
    this.log_manager?.info(
      this.generation_log_text(config, "app.translation_generation.log.started"),
      { source: FILE_GENERATION_LOG_SOURCE },
    );
    try {
      const project_path = this.session_state.require_loaded_project_path();
      const result = await write(project_path, setting);
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

  /** 各入口共用 PDF 预检与写出，格式调度按各自类型选择资产。 */
  private async write_files(
    project_path: string,
    setting: JsonRecord,
    target: GenerationTarget,
  ): Promise<TranslationFileGenerationResult> {
    const config = build_project_execution_settings(
      setting,
      read_project_language_settings(await this.database.get_all_meta(project_path)),
    );
    const assets = await this.database.get_all_asset_records(project_path);
    // 重复译文填充只修改导出副本。
    const items = (await this.database.get_all_items(project_path)).map((item) =>
      create_item(item),
    );
    const documents = target.skip_pdf
      ? []
      : await this.read_generation_pdf_files(
          project_path,
          Object.keys(await this.database.read_pdf_summaries(project_path)),
        );
    this.fill_duplicated_translations(items);
    const { paths, generic_path } = target;
    this.native_fs.make_dir(paths.translated_path);
    this.native_fs.make_dir(paths.bilingual_path);
    const format_service = new FileFormatService(
      this.game_directory_operations,
      { target_language: config.target_language },
      this.pdf_execution,
      this.native_fs,
    );
    await format_service.write_items(
      items,
      {
        paths,
        asset_reader: (rel_path) => this.database.read_asset_content(project_path, rel_path),
        source_files: assets,
      },
      generic_path,
    );
    const pdf_files = await this.write_pdf_files(project_path, paths, documents);
    return {
      accepted: true,
      output_path: paths.translated_path,
      bilingual_output_path: paths.bilingual_path,
      ...(generic_path === undefined ? {} : { generic_input_path: generic_path }),
      pdf_files,
    };
  }

  /** 在任何输出落盘前固定译稿并验证可确定条件，避免不同入口各自解释 PDF 规则。 */
  private async read_generation_pdf_files(
    project_path: string,
    file_paths: readonly string[],
  ): Promise<PDFDocumentRecord[]> {
    const documents = await this.database.read(project_path, (reader) =>
      file_paths.map((file_path) => {
        const document = reader.read_pdf_document(project_path, file_path);
        if (!document)
          throw new AppError("file.not_found", { public_details: { file: file_path } });
        return { file_path, document };
      }),
    );
    for (const { file_path, document } of documents) {
      try {
        render_pdf_translation(document);
      } catch (error) {
        throw new AppError("file.invalid_structure", {
          public_details: { file: file_path },
          cause: error,
        });
      }
    }
    return documents;
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
    output_directory: string,
    app_language: AppLanguage,
  ): GeneratedFilePaths {
    const text = create_text_resolver(resolve_app_locale(app_language));
    const translated_suffix = text("app.translation_generation.directory.translated");
    const bilingual_suffix = text("app.translation_generation.directory.bilingual");
    const stem = path.parse(project_path).name;
    const translated_base = `${stem}_${translated_suffix}`;
    const bilingual_base = `${stem}_${bilingual_suffix}`;
    let suffix = "";
    let index = 0;
    let timestamp = ""; // 同一次生成的重名候选共用时间戳，后续冲突只递增编号。
    while (
      this.native_fs.exists(path.join(output_directory, `${translated_base}${suffix}`)) ||
      this.native_fs.exists(path.join(output_directory, `${bilingual_base}${suffix}`))
    ) {
      if (suffix === "") suffix = timestamp = this.timestamp_suffix();
      else suffix = `${timestamp}_${++index}`;
    }
    return {
      translated_path: path.join(output_directory, `${translated_base}${suffix}`),
      bilingual_path: path.join(output_directory, `${bilingual_base}${suffix}`),
    };
  }

  /**
   * `DUPLICATED` 条目复用组内首个已完成译文。
   */
  private fill_duplicated_translations(items: Item[]): void {
    const translations = new Map<string, Item>(); // 条目按数据库 ID 顺序读取，首个成果即组内最小 ID。
    for (const item of items) {
      if (item.status !== "PROCESSED") {
        continue;
      }
      const key = build_project_item_duplicate_key(item);
      if (!translations.has(key)) translations.set(key, item);
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
